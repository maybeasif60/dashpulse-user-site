const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// পাসপোর্ট কনফিগারেশন
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.REDIRECT_URI, // বা process.env.GOOGLE_CALLBACK_URL
    passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails[0].value;
        
        // এখানে আপনার ডাটাবেজে ইউজারের রিফ্রেশ টোকেন সেভ করে রাখতে হবে, 
        // যাতে পরে /api/gmail/messages রাউটে সেটি ব্যবহার করতে পারেন।
        if (refreshToken) {
            await db.collection('clients').doc(email).set({
                email: email,
                refreshToken: refreshToken,
                updatedAt: new Date()
            }, { merge: true });
        }

        return done(null, { email, refreshToken });
    } catch (error) {
        return done(error, null);
    }
}));

// ১. গুগল লগইন শুরু করার রাউট (এই রাউটটি না থাকায় 'Cannot get auth' আসছিল)
app.get('/auth/google',
    passport.authenticate('google', {
        scope: [
            'profile',
            'email',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/photoslibrary.readonly'
        ],
        accessType: 'offline',
        prompt: 'consent'
    })
);

// ২. গুগল থেকে ঘুরে আসার পর কলব্যাক রাউট
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        // সফলভাবে লগইন হলে সেশনে ইমেইল সেভ করে ড্যাশবোর্ডে রিডাইরেক্ট করুন
        req.session.userEmail = req.user.email;
        res.redirect('/dashboard.html'); // অথবা আপনার হোমপেজ বা ড্যাশবোর্ড লিংক
    }
);
