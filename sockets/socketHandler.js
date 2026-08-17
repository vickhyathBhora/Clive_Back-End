// socketHandler.js
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const {
  fetchAllContacts,
  getUserById,
  deleteMessagesBetweenUsers,
  removeContactTransaction,
  getMessagesBetweenUsers,
  createPendingContact,
  deleteContactBetweenUsers,
} = require('../config/quaryfuns');


const {
  addConnectedUser,
  removeConnectedUser,
  getSocketIdByUserId,
} = require('./connectedUsers');
// Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your SMTP provider configuration
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

module.exports = function registerSocketHandlers(io) {
  // 1. AUTHENTICATION MIDDLEWARE
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token || socket.handshake.headers?.authorization;

      if (!token) {
        return next(new Error('AUTH_ERROR: Token missing'));
      }

      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const decoded = jwt.verify(
        cleanToken,
        process.env.JWT_SECRET || 'YOUR_JWT_SECRET'
      );

      // Save decoded object and resolve standard user ID key
      socket.user = decoded;
      socket.userId = decoded.id || decoded.userId;

      if (!socket.userId) {
        return next(new Error('AUTH_ERROR: Invalid token payload'));
      }

      next();
    } catch (err) {
      console.error(`🔒 Socket Auth Failed [${socket.id}]:`, err.message);

      if (err.name === 'TokenExpiredError') {
        return next(new Error('AUTH_ERROR: Token expired'));
      }

      return next(new Error('AUTH_ERROR: Invalid token'));
    }
  });

  // 2. CONNECTION HANDLER
  io.on('connection', (socket) => {
    const currentUserId = socket.userId;
    socket.join(currentUserId);
  console.log(`⚡ User ${currentUserId} joined private room: ${currentUserId}`);
    console.log(`⚡ Socket Connected: ${socket.id} | User ID: ${socket.userId}`);

addConnectedUser(currentUserId, socket.id);
    console.log(`⚡ Socket Connected: ${socket.id} | User ID: ${currentUserId}`);

    // Request Initial Data Handler
    socket.on('request_initial_data', async (payload) => {
      try {
        const res = await fetchAllContacts(socket.userId);

        socket.emit('initial_data', {
          status: 'success',
          user: socket.user,
          res,
        });
      } catch (error) {
        console.error('Error fetching initial data:', error);
        socket.emit('initial_data_error', {
          message: 'Failed to load initial data',
        });
      }
    });

    // Delete Contact Handler
    socket.on('delete_contact', async (data) => {
      const currentUserId = socket.userId;
      const { targetId } = data;

      if (!targetId) {
        return socket.emit('delete_contact_res', {
          success: false,
          message: 'Target ID is required',
        });
      }

      try {
        // Retrieve profiles for notification email prior to deletion
        const targetUser = await getUserById(targetId);
        const currentUser = await getUserById(currentUserId);

        // Execute DB Transaction (handled safely inside quaryfuns)
        await removeContactTransaction(currentUserId, targetId);

        // Non-blocking background email dispatch
      /*  if (targetUser && currentUser) {
          const mailOptions = {
            from: process.env.EMAIL_USER,
            to: targetUser.email,
            subject: 'Contact Removed Notification',
            text: `Hello ${targetUser.name},\n\n${currentUser.name} (${currentUser.email}) has removed you from their contacts list on ChatLive.\n\nBest regards,\nChatLive Team`,
          };

          transporter.sendMail(mailOptions).catch((emailErr) => {
            console.error(
              'Failed to send contact removal email:',
              emailErr.message
            );
          });
        }
*/
        socket.emit('delete_contact_res', {
          success: true,
          targetId,
          message: 'Contact and associated chat history successfully deleted',
        });
      } catch (error) {
        console.error('Error in delete_contact socket handler:', error);
        socket.emit('delete_contact_res', {
          success: false,
          message: 'Server error while deleting contact',
        });
      }
    });

    // Delete Chat History Handler
  
    socket.on('delete_chat_history', async (data) => {
      const currentUserId = socket.userId;
      const { targetId } = data;

      if (!targetId) {
        return socket.emit('delete_chat_history_res', {
          success: false,
          message: 'Target ID is required',
        });
      }

      try {
        await deleteMessagesBetweenUsers(currentUserId, targetId);

        socket.emit('delete_chat_history_res', {
          success: true,
        });
      } catch (error) {
        console.error('Error in delete_chat_history socket handler:', error);
        socket.emit('delete_chat_history_res', {
          success: false,
          message: 'Server error while clearing chat history',
        });
      }
    });

    
socket.on('get_messages', async (data) => {
  try {
         const currentUserId = socket.userId;
    
    // Extract target UUID safely from nested object structures
    const selectedChat = data?.selectedChat;
    const targetUserId = selectedChat?.contact?.id || selectedChat?.id;

    console.log('📩 [Backend] Received get_messages request for:', { currentUserId, targetUserId });

    if (!currentUserId || !targetUserId) {
      return socket.emit('get_messages_res', {
        success: false,
        message: 'Invalid sender or receiver ID',
      });
    }console.log(currentUserId, targetUserId);

    const messages = await getMessagesBetweenUsers(currentUserId, targetUserId);
    
    // Emit response back to sender
    socket.emit('get_messages_res', {
      success: true,
      messages: messages,
    });
  } catch (err) {
    console.error('Error fetching messages:', err);
    socket.emit('get_messages_res', {
      success: false,
      message: 'Failed to retrieve messages',
    });
  }
});

socket.on('send_invite', async (targetUserId, targetUserMail) => {
  try {
    const currentUserId = socket.userId;

    console.log('📩 [Backend] Received send_invite for target:', targetUserId);

    if (!currentUserId || !targetUserId) {
      return socket.emit('send_invite_res', {
        success: false,
        message: 'Invalid sender or receiver ID',
      });
    }

    // 1. Save pending contact in PostgreSQL
    const newContact = await createPendingContact(currentUserId, targetUserId);

    // 2. Emit success response back to the sender
    socket.emit('send_invite_res', {
      success: true,
      contact: newContact,
    });

    // 3. Check online status & handle notifications
    const receiverSocketId = getSocketIdByUserId(targetUserId);

    if (receiverSocketId) {
      console.log(`⚡ Target user ${targetUserId} is online! Emitting live invite & sending email.`);

      // Emit live invite to online recipient
      io.to(receiverSocketId).emit('new_invite_received', {
        success: true,
        contact: newContact,
      });

      // Send email if targetUserMail is present
      if (targetUserMail) {
        const senderName = socket.user?.name || socket.user?.email || 'A user';

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: targetUserMail,
          subject: 'New Connection Request on ChatLive',
          text: `Hello,\n\n${senderName} has sent you a connection request on ChatLive.\n\nLog in to accept or reject the request.\n\nBest regards,\nChatLive Team`,
        };

        transporter.sendMail(mailOptions).catch((emailErr) => {
          console.error('Failed to send invite email:', emailErr.message);
        });
      }
    } else {
      console.log(`🌙 Target user ${targetUserId} is offline. Sending email only.`);

      // Send email only when user is offline
      if (targetUserMail) {
        const senderName = socket.user?.name || socket.user?.email || 'A user';

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: targetUserMail,
          subject: 'New Connection Request on ChatLive',
          text: `Hello,\n\n${senderName} has sent you a connection request on ChatLive.\n\nLog in to accept or reject the request.\n\nBest regards,\nChatLive Team`,
        };

        transporter.sendMail(mailOptions).catch((emailErr) => {
          console.error('Failed to send invite email:', emailErr.message);
        });
      }
    }

  } catch (err) {
    console.error('Error in send_invite socket handler:', err);
    socket.emit('send_invite_res', {
      success: false,
      message: 'Failed to send invite',
    });
  }
});


socket.on('reject_invite', async (data) => {
  try {
    console.log(data);
    const currentUserId = socket.userId;
    const targetUserId = data.contactId;

    if (!currentUserId || !targetUserId) {
      return socket.emit('reject_invite_res', {
        success: false,
        message: 'Invalid sender or target user ID',
      });
    }

    console.log(`Rejecting invite between ${currentUserId} and ${targetUserId}`);

    const result = await deleteContactBetweenUsers(currentUserId, targetUserId);
console.log(result);
    if (result.success && result.deleted) {
     socket.emit('reject_invite_res', {
  success: true,
  contactId: targetUserId,
  message: 'Invite rejected successfully',
});
    } else {
      socket.emit('reject_invite_res', {
        success: false,
        message: 'Contact record not found or already deleted',
      });
    }
  } catch (err) {
    console.error('Error in reject_invite socket event:', err);
    socket.emit('reject_invite_res', {
      success: false,
      message: 'Failed to reject invite',
    });
  }
});

    socket.on('disconnect', (reason) => {
      removeConnectedUser(currentUserId);
      console.log(`❌ Socket Disconnected [${socket.id}]: ${reason}`);
    });
  });
};

