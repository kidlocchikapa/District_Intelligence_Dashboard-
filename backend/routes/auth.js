const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { query } = require('../db');

// Basic Authentication
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Look up user in database
        const result = await query('SELECT * FROM users WHERE username = $1', [username]);
        
        let validUser = false;
        let role = 'user';
        
        // As a fallback for trying out the frontend, allow admin/admin if DB completely empty
        if (result.rows.length === 0) {
            // Check if DB users is completely empty
            const totalUsers = await query('SELECT COUNT(*) FROM users');
            if (totalUsers.rows[0].count === '0' && username === 'admin' && password === 'admin') {
                validUser = true;
                role = 'super_admin';
            } else {
                return res.status(401).json({ error: 'Invalid credentials or user does not exist.' });
            }
        } else {
            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) return res.status(401).json({ error: 'Invalid credentials.' });
            validUser = true;
            role = user.role;
        }

        if (validUser) {
            const token = jwt.sign({ username, role }, process.env.JWT_SECRET || 'secret', { expiresIn: '8h' });
            res.json({ message: 'Login successful', token, role });
        }
    } catch (err) {
        console.error("Login error: ", err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Registration Endpoint for initial setup
router.post('/register', async (req, res) => {
    const { username, email, password, full_name } = req.body;

    try {
        const userExists = await query('SELECT * FROM users WHERE username = $1 OR email = $2', [username, email || `${username}@example.com`]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        await query(
            'INSERT INTO users (username, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)',
            [username, email || `${username}@example.com`, password_hash, full_name || username, 'admin']
        );

        res.status(201).json({ message: 'User registered successfully! You can now log in.' });
    } catch (err) {
        console.error("Registration error: ", err);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

module.exports = router;
