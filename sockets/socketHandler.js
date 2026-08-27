// socketHandler.js
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { socketConnectionGuard } = require('../middleware/systemGuard');
const { applySocketThrottling } = require('../middleware/socketThrottle');
const {
  createPendingContact,
  fetchAllContacts,
  getMessagesByContactId,
  getUserById,
  deleteMessagesByContactId,
  removeContact,
  acceptContact,
} = require('../config/quaryfuns');


const {
  addConnectedUser,
  removeConnectedUser,
  getSocketIdByUserId,
  updateUserSelectedChatLocal,
} = require('./connectedUsers');

const { addUserRadis,
  updateUserSelectedChat,
  removeUserRadis,
  getUserRadis,
} = require('../presence'); // your Redis presence helper

const SERVER_ID = process.env.SERVER_ID || 'server_1';

// Configure Nodemailer transporter


module.exports = function registerSocketHandlers(io) {
  // 1. AUTHENTICATION MIDDLEWARE
  io.use(socketConnectionGuard);
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
  io.on('connection', async (socket) => {
    const currentUserId = socket.userId;

    socket.join(currentUserId);
    console.log(`⚡ User ${currentUserId} joined private room: ${currentUserId}`);
    console.log(`⚡ Socket Connected: ${socket.id} | User ID: ${socket.userId}`);

    addConnectedUser(currentUserId, socket.id);
    console.log(`⚡ Socket Connected: ${socket.id} | User ID: ${currentUserId}`);

    try {
      await addUserRadis(currentUserId, socket.id, SERVER_ID);
      console.log(`⚡ Redis Presence Updated | User: ${currentUserId} registered to ${SERVER_ID}`);
    } catch (err) {
      console.error('❌ Redis Error on connection:', err);
    }
    applySocketThrottling(socket);
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
    /*
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
            const currentUser =
            
            await getUserById(currentUserId);
    
            // Execute DB Transaction (handled safely inside quaryfuns)
            await removeContact(currentUserId, targetId);//send id only 
    
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
            await deleteMessagesByContactId(currentUserId, targetId);//send id only 
    
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
    */

    socket.on('get_messages', async (data) => {
      try {
        const currentUserId = socket.userId;

        // Extract target UUID safely from nested object structures
        const contactId = data?.contactId;

        console.log('📩 [Backend] Received get_messages request for:', { contactId });

        if (!contactId) {
          return socket.emit('get_messages_res', {
            success: false,
            message: 'Invalid sender or receiver ID',
          });
        }

        const messages = await getMessagesByContactId(contactId);

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

        // 1. Check Local Server (RAM)
        const localSocketId = getSocketIdByUserId(targetUserId);

        if (localSocketId) {
          console.log(`⚡ Target user ${targetUserId} is online locally! Emitting live invite.`);
          io.to(targetUserId).emit('new_invite_received', {
            success: true,
            contact: newContact,
          });
        } else {
          // 2. Local check failed -> Check Redis (Server 2 / Server 3)
          const redisPresence = await getUserRadis(targetUserId);

          if (redisPresence) {
            console.log(`⚡ Target user ${targetUserId} is online on Redis node (${redisPresence.serverId})! Emitting live invite.`);
            io.to(targetUserId).emit('new_invite_received', {
              success: true,
              contact: newContact,
            });
          } else {
            console.log(`🌙 Target user ${targetUserId} is completely offline.`);
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


    socket.on('accept_invite', async (data) => {
      try {
        const currentUserId = socket.userId;
        const targetUserId = data?.targetUserId; // Friend who sent the request

        if (!targetUserId) {
          return socket.emit('accept_invite_res', {
            success: false,
            message: 'Missing targetUserId',
          });
        }

        // 1. DB transaction: Shift ranks + update status to accepted
        const result = await acceptContact(currentUserId, targetUserId);

        if (!result.success || !result.contact) {
          return socket.emit('accept_invite_res', {
            success: false,
            message: result.message || 'Pending contact request not found',
          });
        }

        // 2. Emit success response BACK to the user who clicked Accept
        socket.emit('accept_invite_res', {
          success: true,
          contact: result.contact,
          message: 'Invite accepted successfully',
        });

        // 3. Fetch email details for the friend who sent the request
        const userQuery = `SELECT email, name FROM users WHERE id = $1::uuid;`;
        const { rows: friendRows } = await db.query(userQuery, [targetUserId]);

        const friendUser = friendRows[0];
        const friendEmail = friendUser?.email;
        const friendName = friendUser?.name || 'User';

  

        // -------------------------------------------------------------
        // DUAL-LAYER PRESENCE CHECK FOR FRIEND (targetUserId)
        // -------------------------------------------------------------

        // 1. LOCAL CHECK (Friend is on THIS server)
        const localSocketId = getSocketIdByUserId(targetUserId);

        if (localSocketId) {
          console.log('--------------------------------------------------');
          console.log('🔍 [PRESENCE DEBUG] Local Check: MATCH FOUND!');
          console.log(`📍 Target User ID : ${targetUserId}`);
          console.log(`🔌 Local Socket ID : ${localSocketId}`);
          console.log('⚡ Emitting live accepted_your_invite event locally...');
          console.log('--------------------------------------------------');

          // Send result.contact directly as payload
          io.to(targetUserId).emit('accepted_your_invite', result.contact);
          await sendAcceptanceEmail();

        } else {
          // 2. REDIS CHECK (Friend is online on another server)
          console.log('--------------------------------------------------');
          console.log('🔍 [PRESENCE DEBUG] Local Check: NOT FOUND in RAM.');
          console.log(`📍 Querying Redis for Target User ID: ${targetUserId}...`);

          const redisPresence = await getUserRadis(targetUserId);

          if (redisPresence) {
            console.log('🔍 [PRESENCE DEBUG] Redis Check: MATCH FOUND!');
            console.log(`🖥️ Remote Server Node : ${redisPresence.serverId}`);
            console.log(`🔌 Remote Socket ID  : ${redisPresence.socketId}`);
            console.log('⚡ Emitting cross-server accepted_your_invite via Redis...');
            console.log('--------------------------------------------------');

            // Send result.contact directly as payload
            io.to(targetUserId).emit('accepted_your_invite', result.contact);
            await sendAcceptanceEmail();

          } else {
            // 3. OFFLINE CHECK (Friend is offline everywhere)
            console.log('🔍 [PRESENCE DEBUG] Redis Check: NOT FOUND.');
            console.log(`💤 User ${targetUserId} is OFFLINE on all servers.`);
            console.log('✉️ Proceeding with email notification only.');
            console.log('--------------------------------------------------');

            const query = `
  UPDATE contacts
  SET 
    user_low_time = CASE 
      WHEN user_low = $2::uuid THEN NOW() 
      ELSE user_low_time 
    END,
    user_high_time = CASE 
      WHEN user_high = $2::uuid THEN NOW() 
      ELSE user_high_time 
    END,
    user_low_unseen = CASE 
      WHEN user_low = $2::uuid THEN COALESCE(user_low_unseen, 0) + 1 
      ELSE user_low_unseen 
    END,
    user_high_unseen = CASE 
      WHEN user_high = $2::uuid THEN COALESCE(user_high_unseen, 0) + 1 
      ELSE user_high_unseen 
    END
  WHERE (user_low = $1::uuid AND user_high = $2::uuid)
     OR (user_low = $2::uuid AND user_high = $1::uuid);
`;

            await db.query(query, [currentUserId, targetUserId]);

            await sendAcceptanceEmail();
          }
        }
      } catch (err) {
        console.error('Error in accept_invite event:', err);
        socket.emit('accept_invite_res', {
          success: false,
          message: 'Server error accepting invite',
        });
      }
    });

    socket.on('reject_invite', async (data) => {
      try {
        console.log('Reject invite payload received:', data);

        const currentUserId = socket.userId;
        const contactId = data?.contactId;

        if (!contactId) {
          return socket.emit('reject_invite_res', {
            success: false,
            message: 'Invalid contact ID',
          });
        }

        console.log(`Rejecting invite for contact ID: ${contactId}`);

        // 1. Delete contact and receive the row data (RETURNING *)
        const result = await removeContact(contactId);
        console.log('removeContact result:', result);

        if (!result.success || !result.data) {
          return socket.emit('reject_invite_res', {
            success: false,
            message: 'Contact record not found or already deleted',
          });
        }

        const row = result.data;

        // 2. Emit success back to the user performing the rejection
        socket.emit('reject_invite_res', {
          success: true,
          contactId: row.id,
          message: 'Invite rejected successfully',
        });

        // 3. Extract friend's UUID (the one that is NOT currentUserId)
        const friendUserId = String(row.user_low) === String(currentUserId) ? row.user_high : row.user_low;

        // 4. Fetch details for BOTH users in a SINGLE pool query
        const usersQuery = `
      SELECT id, email, name 
      FROM users 
      WHERE id IN ($1::uuid, $2::uuid);
    `;

        const { rows: userRows } = await db.query(usersQuery, [friendUserId, currentUserId]);

        // Separate current user (rejector) and friend from the query result
        const friendUser = userRows.find((u) => String(u.id) === String(friendUserId));
        const currentUser = userRows.find((u) => String(u.id) === String(currentUserId));

        const friendEmail = friendUser?.email;
        const friendName = friendUser?.name || 'User';
        const rejectorName = currentUser?.name || 'A user';

        // -------------------------------------------------------------
        // STEP 1: LOCAL CHECK (Target user is on THIS server)
        // -------------------------------------------------------------
        const localSocketId = getSocketIdByUserId(friendUserId);

        if (localSocketId) {
          console.log(`⚡ Target user ${friendUserId} found locally! Emitting live rejection.`);

          // 1. Emit live socket event locally
          io.to(friendUserId).emit('rejected_your_invite', {
            success: true,
            contactId: row.id,
            rejectedByName: rejectorName,
            message: `${rejectorName} declined your invitation`,
          });

     

          // -------------------------------------------------------------
          // STEP 2: REDIS CHECK (Target user is online on Server 2/3)
          // -------------------------------------------------------------
        } else {
          const redisPresence = await getUserRadis(friendUserId);

          if (redisPresence) {
            console.log(`⚡ Target user ${friendUserId} found in Redis on Server node: ${redisPresence.serverId}! Emitting cross-server rejection.`);

            // 1. Emit live socket event cross-server via Redis adapter
            io.to(friendUserId).emit('rejected_your_invite', {
              success: true,
              contactId: row.id,
              rejectedByName: rejectorName,
              message: `${rejectorName} declined your invitation`,
            });

         

            // -------------------------------------------------------------
            // STEP 3: OFFLINE CHECK (Target user is offline everywhere)
            // -------------------------------------------------------------
          } else {
            console.log(`💤 User ${friendUserId} is offline on all servers. Only sending email.`);
          }
        }
      } catch (err) {
        console.error('Error in reject_invite socket event:', err);
        socket.emit('reject_invite_res', {
          success: false,
          message: 'Failed to reject invite',
        });
      }
    });

    socket.on('send_message', async (data) => {
      console.log('📥 [BACKEND] Received sendmessage payload:', data);

      try {
        const { sender_id, receiver_id, contact_id, content } = data;

        if (!sender_id || !receiver_id || !contact_id || !content) {
          console.warn('⚠️ [BACKEND] Validation failed. Missing params:', { sender_id, receiver_id, contact_id, content });
          return socket.emit('sendmessageres', {
            success: false,
            message: 'Missing required parameters',
          });
        }

        // 1. Insert message into PostgreSQL database
        const insertMessageQuery = `
      INSERT INTO messages (contact_id, sender_id, receiver_id, content)
      VALUES ($1::integer, $2::uuid, $3::uuid, $4)
      RETURNING *;
    `;

        console.log('💾 [BACKEND] Saving message to database...');
        const { rows } = await db.query(insertMessageQuery, [
          contact_id,
          sender_id,
          receiver_id,
          content,
        ]);

        const savedMessage = rows[0];
        console.log('✅ [BACKEND] Saved Message DB Record:', savedMessage);

        const incrementQuery = `
      UPDATE contacts
      SET 
        user_low_unseen = CASE WHEN user_low = $1::uuid THEN user_low_unseen + 1 ELSE user_low_unseen END,
        user_high_unseen = CASE WHEN user_high = $1::uuid THEN user_high_unseen + 1 ELSE user_high_unseen END
      WHERE id = $2::integer;
    `;



        // 2. Check Local & Redis Delivery
        const localSocketId = getSocketIdByUserId(receiver_id);
        let isDelivered = false;

        if (localSocketId) {
          console.log(`⚡ [BACKEND] Target user ${receiver_id} found locally! Emitting new_message.`);
          io.to(receiver_id).emit('new_message', {
            success: true,
            data: savedMessage, // Fixed: changed 'message' to 'data' to match frontend
          });
          if (localSocketId.selectedChat !== contact_id) {
            try {
              await db.query(incrementQuery, [receiver_id, contact_id]);
            } catch (error) {
              console.error("Error executing increment query:", error);
              throw error;
            }
          }
          isDelivered = true;
        } else {
          const redisPresence = await getUserRadis(receiver_id);
          if (redisPresence) {
            console.log(`⚡ [BACKEND] Target user ${receiver_id} found in Redis! Emitting new_message.`);
            io.to(receiver_id).emit('new_message', {
              success: true,
              data: savedMessage, // Fixed: changed 'message' to 'data' to match frontend
            });
            if (redisPresence.selectedChat !== contact_id) {
              try {
                await db.query(incrementQuery, [receiver_id, contact_id]);
              } catch (error) {
                console.error("Error executing increment query:", error);
                throw error;
              }
            }
            isDelivered = true;
          } else {
            console.log(`ℹ️ [BACKEND] Target user ${receiver_id} is offline.`);
          }
        }

        // 3. Update Contacts Table (Timestamps & Unseen Count)
        if (!isDelivered) {
          console.log('🔄 [BACKEND] Updating contacts timestamps in DB...');
          const updateContactsQuery = `
  UPDATE contacts
  SET 
    -- 1. Receiver is in user_low: update low_time to NOW() and increment low_unseen
    user_low_time = CASE 
      WHEN user_low = $1::uuid THEN NOW() 
      ELSE user_low_time 
    END,
    user_low_unseen = CASE 
      WHEN user_low = $1::uuid THEN user_low_unseen + 1 
      ELSE user_low_unseen 
    END,

    -- 2. Receiver is in user_high: update high_time to NOW() and increment high_unseen
    user_high_time = CASE 
      WHEN user_high = $1::uuid THEN NOW() 
      ELSE user_high_time 
    END,
    user_high_unseen = CASE 
      WHEN user_high = $1::uuid THEN user_high_unseen + 1 
      ELSE user_high_unseen 
    END
  WHERE id = $2::integer;
`;

          // $1 = receiver_id, $2 = contact_id
          await db.query(updateContactsQuery, [receiver_id, contact_id]);
          console.log('✅ [BACKEND] Contacts table updated successfully.');
        }

        // 4. Acknowledge sender (Fixed event name to 'sendmessageres')
        console.log('📤 [BACKEND] Emitting sendmessageres back to sender socket.');
        socket.emit('send_message_res', {
          success: true,
          data: savedMessage,
        });

      } catch (err) {
        console.error('❌ [BACKEND] Error in sendmessage socket handler:', err);
        socket.emit('send_message_res', {
          success: false,
          message: 'Database error',
        });
      }
    });

    socket.on('update_unseen', async ({ contact_id }) => {
      const userId = socket.userId; // Or pass userId from frontend if not stored on socket session
      await updateUserSelectedChat(userId, contact_id);

      await updateUserSelectedChatLocal(userId, contact_id);
      try {
        const query = `
      UPDATE contacts
      SET 
        user_low_unseen = CASE WHEN user_low = $1::uuid THEN 0 ELSE user_low_unseen END,
        user_high_unseen = CASE WHEN user_high = $1::uuid THEN 0 ELSE user_high_unseen END
      WHERE id = $2::integer;
    `;

        await db.query(query, [userId, contact_id]);
        console.log(`✅ [BACKEND] Reset unseen count to 0 for contact: ${contact_id}`);
      } catch (error) {
        console.error('❌ [BACKEND] Error resetting unseen count:', error);
      }
    });


    socket.on('update_contact_rows', async (payload) => {
      const currentUserId = socket.userId; // Your logged-in user UUID
      const { contacts_meta } = payload || {};

      if (!currentUserId || !contacts_meta || !Array.isArray(contacts_meta)) {
        console.warn('⚠️ Invalid payload or unauthenticated socket user.');
        socket.emit('update_contact_rows_res', false);
        return;
      }


      try {
        const query = `
  UPDATE contacts
  SET 
    user_low_rank = CASE 
      WHEN user_low = $1::uuid THEN $3::integer 
      ELSE user_low_rank 
    END,
    user_high_rank = CASE 
      WHEN user_high = $1::uuid THEN $3::integer 
      ELSE user_high_rank 
    END,
    user_low_time = CASE 
      WHEN user_low = $1::uuid THEN NULL::timestamptz 
      ELSE user_low_time 
    END,
    user_high_time = CASE 
      WHEN user_high = $1::uuid THEN NULL::timestamptz 
      ELSE user_high_time 
    END
  WHERE id = $2::bigint;
`;

        for (const item of contacts_meta) {
          // item.id parsed to BigInt/Number to match bigint column
          await db.query(query, [currentUserId, Number(item.id), Number(item.rank)]);
        }
        console.log(`✅ Successfully updated ${contacts_meta.length} ranks & cleared timestamps.`);

        // Acknowledge back to frontend so it can fetch initial data
        socket.emit('update_contact_rows_res', true);

      } catch (error) {
        console.error('❌ Error in update_contact_rows handler:', error);
        socket.emit('update_contact_rows_res', false);
      }
    });

    socket.on('disconnect', async (reason) => {
      removeConnectedUser(currentUserId);
      console.log(`❌ Socket Disconnected [${socket.id}]: ${reason}`);

      // Step B: Remove from Redis presence
      try {
        await removeUserRadis(currentUserId);
        console.log(`❌ Removed from Redis presence [User ${currentUserId}]`);
      } catch (err) {
        console.error('❌ Redis Error on disconnect:', err);
      }

    });
  });
};

