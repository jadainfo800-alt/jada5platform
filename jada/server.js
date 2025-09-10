// File: server.js
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'jada5-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/jada5', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: String,
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Transaction Schema
const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['deposit', 'withdrawal', 'game_purchase', 'prize_won'], required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    amount: { type: Number, required: true },
    transactionId: { type: String, required: true, unique: true },
    description: String,
    createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Game Schema
const gameSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, enum: ['wheel', 'draw'], required: true },
    price: { type: Number, required: true },
    prizePool: { type: Number, required: true },
    durationDays: { type: Number, required: true },
    spinsPerDay: { type: Number, required: true },
    prizes: [{
        position: Number,
        amount: Number
    }],
    active: { type: Boolean, default: true }
});

const Game = mongoose.model('Game', gameSchema);

// Ticket Schema
const ticketSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', required: true },
    ticketCode: { type: String, required: true, unique: true },
    purchaseDate: { type: Date, default: Date.now },
    drawDate: { type: Date, required: true },
    status: { type: String, enum: ['active', 'won', 'lost'], default: 'active' },
    prizeWon: { type: Number, default: 0 }
});

const Ticket = mongoose.model('Ticket', ticketSchema);

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Routes

// User registration
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, phone } = req.body;
        
        // Check if user exists
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Create user
        const user = new User({
            username,
            email,
            password: hashedPassword,
            phone,
            balance: 0
        });
        
        await user.save();
        
        // Set session
        req.session.userId = user._id;
        
        res.status(201).json({
            message: 'User created successfully',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                balance: user.balance
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // Set session
        req.session.userId = user._id;
        
        res.json({
            message: 'Login successful',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                balance: user.balance
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User logout
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out' });
        }
        res.clearCookie('connect.sid');
        res.json({ message: 'Logout successful' });
    });
});

// Get user profile
app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('-password');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user balance
app.get('/api/balance', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ balance: user.balance });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get transactions
app.get('/api/transactions', requireAuth, async (req, res) => {
    try {
        const transactions = await Transaction.find({ userId: req.session.userId })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(transactions);
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Process deposit (simulate Pesapal integration)
app.post('/api/deposit', requireAuth, async (req, res) => {
    try {
        const { amount, transactionId } = req.body;
        
        // In a real implementation, you would verify the transaction with Pesapal
        // For this demo, we'll simulate a successful deposit
        
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Update balance
        user.balance += amount;
        await user.save();
        
        // Create transaction record
        const transaction = new Transaction({
            userId: user._id,
            type: 'deposit',
            status: 'completed',
            amount,
            transactionId,
            description: 'Deposit via Pesapal'
        });
        await transaction.save();
        
        res.json({
            message: 'Deposit successful',
            balance: user.balance
        });
    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Process withdrawal request
app.post('/api/withdraw', requireAuth, async (req, res) => {
    try {
        const { amount, phone } = req.body;
        
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Check sufficient balance
        if (user.balance < amount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        // Create transaction record
        const transaction = new Transaction({
            userId: user._id,
            type: 'withdrawal',
            status: 'pending',
            amount,
            transactionId: 'wd_' + Math.random().toString(36).substr(2, 9),
            description: `Withdrawal to ${phone}`
        });
        await transaction.save();
        
        // In a real implementation, you would initiate the mobile money transfer here
        // For this demo, we'll simulate processing and complete it after a delay
        
        setTimeout(async () => {
            try {
                // Update transaction status
                transaction.status = 'completed';
                await transaction.save();
                
                // Update user balance
                user.balance -= amount;
                await user.save();
                
                // In a real implementation, you would send an SMS confirmation here
                console.log(`SMS would be sent to ${phone}: Your withdrawal of UGX ${amount} was successful.`);
            } catch (error) {
                console.error('Withdrawal processing error:', error);
            }
        }, 5000); // Simulate 5 second processing time
        
        res.json({
            message: 'Withdrawal request received. Processing...',
            transactionId: transaction.transactionId
        });
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get available games
app.get('/api/games', async (req, res) => {
    try {
        const games = await Game.find({ active: true });
        res.json(games);
    } catch (error) {
        console.error('Get games error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Purchase game ticket
app.post('/api/tickets/purchase', requireAuth, async (req, res) => {
    try {
        const { gameId, quantity = 1 } = req.body;
        
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const game = await Game.findById(gameId);
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        const totalCost = game.price * quantity;
        
        // Check sufficient balance
        if (user.balance < totalCost) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        
        // Update user balance
        user.balance -= totalCost;
        await user.save();
        
        // Create transaction record
        const transaction = new Transaction({
            userId: user._id,
            type: 'game_purchase',
            status: 'completed',
            amount: totalCost,
            transactionId: 'tick_' + Math.random().toString(36).substr(2, 9),
            description: `Purchased ${quantity} ticket(s) for ${game.name}`
        });
        await transaction.save();
        
        // Create tickets
        const tickets = [];
        const drawDate = new Date();
        drawDate.setDate(drawDate.getDate() + game.durationDays);
        
        for (let i = 0; i < quantity; i++) {
            const ticketCode = 'T' + Math.random().toString(36).substr(2, 9).toUpperCase();
            
            const ticket = new Ticket({
                userId: user._id,
                gameId: game._id,
                ticketCode,
                drawDate,
                status: 'active'
            });
            
            await ticket.save();
            tickets.push(ticket);
        }
        
        res.json({
            message: 'Tickets purchased successfully',
            tickets,
            balance: user.balance
        });
    } catch (error) {
        console.error('Purchase ticket error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user tickets
app.get('/api/tickets', requireAuth, async (req, res) => {
    try {
        const tickets = await Ticket.find({ userId: req.session.userId })
            .populate('gameId')
            .sort({ purchaseDate: -1 });
        res.json(tickets);
    } catch (error) {
        console.error('Get tickets error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Spin wheel game
app.post('/api/games/spin', requireAuth, async (req, res) => {
    try {
        const { gameId } = req.body;
        
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const game = await Game.findById(gameId);
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        // Check if user has spins available
        // This would require additional logic to track daily spins
        
        // Simulate wheel spin and determine prize
        const prizes = game.prizes;
        const randomIndex = Math.floor(Math.random() * prizes.length);
        const prize = prizes[randomIndex];
        
        // Update user balance if they won
        if (prize.amount > 0) {
            user.balance += prize.amount;
            await user.save();
            
            // Create transaction record for the win
            const transaction = new Transaction({
                userId: user._id,
                type: 'prize_won',
                status: 'completed',
                amount: prize.amount,
                transactionId: 'win_' + Math.random().toString(36).substr(2, 9),
                description: `Won prize from ${game.name} (Position: ${prize.position})`
            });
            await transaction.save();
        }
        
        res.json({
            prize: prize.amount,
            position: prize.position,
            balance: user.balance
        });
    } catch (error) {
        console.error('Spin wheel error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});