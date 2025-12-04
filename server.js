// server.js - Node.js Backend with Auth and Comments
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const session = require('express-session'); // NEW
const passport = require('passport');       // NEW
const GoogleStrategy = require('passport-google-oauth20').Strategy; // NEW
require('dotenv').config(); 

const app = express();
const PORT = process.env.PORT || 3000; 

// --- Config Secrets ---
const JWT_SECRET = process.env.JWT_SECRET || 'your_ultra_secure_secret_key_change_me_in_env'; 
const SESSION_SECRET = process.env.SESSION_SECRET || 'a_default_session_secret';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// --- MongoDB Connection ---
const dbURL = process.env.DB_URL; 
if (!dbURL) {
    console.error("FATAL ERROR: DB_URL environment variable is not set.");
    process.exit(1);
}
mongoose.connect(dbURL)
    .then(() => console.log('✅ Connected to MongoDB Atlas!'))
    .catch((err) => {
        console.error('❌ Error connecting to database:', err.message);
        process.exit(1); 
    });

// --- 1. Define Schemas (Add 'googleId' to User Schema) ---

// Minimal Post Schema (no change)
const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: String, required: true },
    date: { type: Date, default: Date.now },
});
const Post = mongoose.model('Post', postSchema);

// User Schema for Authentication (MODIFIED for OAuth)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: false }, // Password is optional for social users
    googleId: { type: String, unique: true, sparse: true } // NEW field for Google ID
});
// Pre-save hook to hash password (CORRECTED: Removed 'next' and 'next()' for async middleware)
userSchema.pre('save', async function() {
    if (this.isModified('password') && this.password) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    // next() call is no longer needed for async pre-save hooks
});
const User = mongoose.model('User', userSchema);

// Comment Schema (no change)
const commentSchema = new mongoose.Schema({
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    content: { type: String, required: true },
    date: { type: Date, default: Date.now },
});
const Comment = mongoose.model('Comment', commentSchema);


// --- Middleware & Config ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(__dirname)); 

// 🎯 NEW: Configure Session and Passport Middleware
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization/deserialization for session management
passport.serializeUser((user, done) => {
    done(null, user.id);
});
passport.deserializeUser((id, done) => {
    User.findById(id).then(user => {
        done(null, user);
    }).catch(err => done(err));
});


// 🎯 NEW: Configure Google Strategy
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "/api/auth/google/callback" // MUST match redirect URI in Google Console
},
async (accessToken, refreshToken, profile, done) => {
    try {
        // 1. Check if user exists by Google ID
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
            // User exists, log them in
            return done(null, user);
        } else {
            // User does not exist, check by email to prevent duplicate accounts
            user = await User.findOne({ email: profile.emails[0].value });

            if (user) {
                // Existing email/password user, link Google ID
                user.googleId = profile.id;
                await user.save();
                return done(null, user);
            } else {
                // New user, register them
                // Generate a unique username based on display name and a random number
                const baseUsername = profile.displayName.replace(/\s/g, '').substring(0, 10);
                let newUsername = baseUsername + Math.floor(Math.random() * 1000);
                
                // Ensure generated username is unique
                let usernameExists = await User.findOne({ username: newUsername });
                while (usernameExists) {
                    newUsername = baseUsername + Math.floor(Math.random() * 10000);
                    usernameExists = await User.findOne({ username: newUsername });
                }

                const newUser = new User({
                    username: newUsername,
                    email: profile.emails[0].value,
                    googleId: profile.id,
                    // No password field needed
                });
                await newUser.save();
                return done(null, newUser);
            }
        }
    } catch (err) {
        return done(err, null);
    }
}));


// Middleware to protect routes (MODIFIED to also check Passport session)
function authenticateToken(req, res, next) {
    // 1. Check for JWT (for API calls from client-side JS)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.status(403).send('Invalid or expired token.');
            req.user = user; // Contains { userId: ..., username: ... }
            next();
        });
    } 
    // 2. Check for Passport session (for server-side redirects/checks)
    else if (req.isAuthenticated()) {
        // Create a temporary object matching the JWT payload structure
        req.user = { 
            userId: req.user._id, 
            username: req.user.username 
        };
        next();
    }
    // 3. No authentication found
    else {
        return res.status(401).send('Authentication token or session required.');
    }
}


// --- 2. API Endpoints for Authentication (MODIFIED/NEW) ---

// POST /api/auth/register (Traditional Sign Up)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Missing required fields.' });
        }
        if (password.length < 6) {
             return res.status(400).json({ message: 'Password must be at least 6 characters.' });
        }
        
        // Check if user already exists
        let user = await User.findOne({ $or: [{ username }, { email }] });
        if (user) {
            return res.status(409).json({ message: 'Username or email already in use.' });
        }

        const newUser = new User({ username, email, password });
        await newUser.save();

        res.status(201).json({ message: 'Registration successful! You can now log in.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// POST /api/auth/login (Traditional Log In)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email });
        if (!user || !user.password) { // Check for user existence and ensure they have a password (not social-only)
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // Create and send JWT
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: 'Login successful.', token, username: user.username });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// 🎯 NEW: Google OAuth Initiation Route (Step 1 of OAuth)
app.get('/api/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// 🎯 NEW: Google OAuth Callback Route (Step 2 of OAuth)
app.get('/api/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth-form.html?error=google_failed' }),
    (req, res) => {
        // Authentication successful, req.user now contains the MongoDB user object
        
        // 1. Create a JWT for client-side API usage
        const token = jwt.sign(
            { userId: req.user._id, username: req.user.username }, 
            JWT_SECRET, 
            { expiresIn: '1h' }
        );

        // 2. Send the JWT and user data to the client using a temporary page script
        res.send(`
            <script>
                localStorage.setItem('miCommunityAuthToken', '${token}');
                localStorage.setItem('miCommunityUsername', '${req.user.username}');
                window.location.href = '/'; 
            </script>
        `);
    }
);


// --- 3. API Endpoints for Comments & Main Post (UNCHANGED) ---

// Utility route to fetch the one and only post and its ID
app.get('/api/posts/single', async (req, res) => {
    try {
        // Fetch the first post found in the database
        const post = await Post.findOne().select('title content author date'); 
        if (!post) {
            // If no post exists, create a default one for the discussion
            const defaultPost = new Post({
                title: "Welcome to miCommunity Discussion",
                content: "This is the main community discussion thread. Feel free to log in and post your comments below!",
                author: "Admin",
            });
            await defaultPost.save();
            return res.json(defaultPost);
        }
        res.json(post);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching post: ' + err.message });
    }
});

// POST /api/comments (Requires authentication to post)
app.post('/api/comments', authenticateToken, async (req, res) => {
    try {
        const { postId, content } = req.body;
        
        if (!postId || !content) {
             return res.status(400).json({ message: 'Missing postId or comment content.' });
        }
        
        const newComment = new Comment({
            postId: postId,
            userId: req.user.userId,
            username: req.user.username, // Pulled from JWT payload
            content: content,
        });

        await newComment.save();
        res.status(201).json({ message: 'Comment posted successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error posting comment: ' + err.message });
    }
});

// GET /api/comments/:postId (Fetch all comments for a post)
app.get('/api/comments/:postId', async (req, res) => {
    try {
        const comments = await Comment.find({ postId: req.params.postId })
            .select('username content date') 
            .sort({ date: 1 }); 
        res.json(comments);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching comments: ' + err.message });
    }
});

// --- Server Startup ---
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});