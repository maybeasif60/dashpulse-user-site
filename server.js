// TEST ROUTE: Fetch User Gmail Messages with Official Label mapping and Full Body
app.get('/api/gmail/messages', async (req, res) => {
    const email = req.query.email || req.session.userEmail;

    if (!email) {
        return res.status(400).json({ error: 'Email query parameter is required' });
    }

    try {
        const userDoc = await db.collection('clients').doc(email).get();

        if (!userDoc.exists || !userDoc.data().refreshToken) {
            return res.status(404).json({ error: 'No Refresh Token found for this user.' });
        }

        oauth2Client.setCredentials({
            refresh_token: userDoc.data().refreshToken
        });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        // Fetch last 50 messages
        const response = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 50
        });

        const messages = response.data.messages || [];
        const detailedMessages = [];

        for (const msg of messages) {
            // Fetch full message to get labels, headers, and body
            const msgDetail = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id,
                format: 'full'
            });

            const payload = msgDetail.data.payload || {};
            const headers = payload.headers || [];

            const subjectHeader = headers.find(h => h.name && h.name.toLowerCase() === 'subject');
            const fromHeader = headers.find(h => h.name && h.name.toLowerCase() === 'from');

            // labelIds সরাসরি জিমেইল থেকে আসছে (যেমন: ["INBOX", "STARRED", "CATEGORY_PROMOTIONS"])
            const labels = msgDetail.data.labelIds || [];

            // ইমেলের পূর্ণাঙ্গ বডি বের করার ফাংশন
            let bodyContent = '';
            
            function getEmailBody(part) {
                if (part.body && part.body.data) {
                    let buff = Buffer.from(part.body.data, 'base64');
                    bodyContent += buff.toString('utf-8');
                }
                if (part.parts) {
                    part.parts.forEach(p => getEmailBody(p));
                }
            }

            if (payload.parts) {
                payload.parts.forEach(part => getEmailBody(part));
            } else if (payload.body && payload.body.data) {
                let buff = Buffer.from(payload.body.data, 'base64');
                bodyContent = buff.toString('utf-8');
            }

            detailedMessages.push({
                id: msg.id,
                threadId: msg.threadId,
                subject: subjectHeader ? subjectHeader.value : '(No Subject)',
                from: fromHeader ? fromHeader.value : 'Unknown Sender',
                snippet: msgDetail.data.snippet || '',
                body: bodyContent || msgDetail.data.snippet, // পূর্ণাঙ্গ বডি বা ফলব্যাক হিসেবে স্নোনিপেট
                labelIds: labels // এই ল্যাবেলগুলোই এখন ফ্রন্টএন্ডে ফিল্টারিং এর কাজে লাগবে
            });
        }

        res.json({
            email: email,
            messages: detailedMessages
        });

    } catch (error) {
        console.error('Error fetching Gmail messages:', error);
        res.status(500).json({ error: error.message });
    }
});
