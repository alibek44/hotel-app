require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { Hotel, User, Booking } = require('./models/schemas');

const app = express();

// 1. MIDDLEWARE
app.use(express.json());
app.use(cors());

// 2. DATABASE CONNECTION
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ DB Connection Error:", err));

// 3. AUTH MIDDLEWARE
const auth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Access Denied" });
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(403).json({ error: "Invalid Token" });
    }
};

// 4. API ROUTES

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        const user = new User({ ...req.body, password: hashed });
        await user.save();
        res.status(201).json({ message: "User registered" });
    } catch (err) { res.status(500).json({ error: "Registration failed" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (!user || !await bcrypt.compare(req.body.password, user.password)) {
        return res.status(400).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, process.env.JWT_SECRET);
    res.json({ token, role: user.role, username: user.username });
});

// --- HOTEL ROUTES ---
app.get('/api/hotels', async (req, res) => {
    try {
        const { city, price } = req.query;
        let query = {};
        if (city) query.city = { $regex: city, $options: 'i' };
        if (price) query.price = { $lte: Number(price) };
        const hotels = await Hotel.find(query);
        res.json(hotels);
    } catch (err) { res.status(500).json({ error: "Search failed" }); }
});

app.post('/api/hotels', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Admins only" });
    try {
        const hotel = new Hotel({ ...req.body, reviews: [] });
        await hotel.save();
        res.status(201).json(hotel);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/hotels/:id', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admins only");
    try {
        const hotel = await Hotel.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
        res.json(hotel);
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/api/hotels/:id', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Admins only" });
    try {
        await Hotel.findByIdAndDelete(req.params.id);
        res.json({ message: "Hotel deleted" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- REVIEW ROUTE ---
app.post('/api/hotels/:id/reviews', auth, async (req, res) => {
    try {
        const { comment, rating } = req.body;
        const updatedHotel = await Hotel.findByIdAndUpdate(
            req.params.id,
            { $push: { reviews: { username: req.user.username, comment, rating: Number(rating) } } },
            { new: true }
        );
        res.json(updatedHotel);
    } catch (err) { res.status(500).json({ error: "Review failed" }); }
});

// --- BOOKING ROUTES WITH AVAILABILITY LOGIC ---

// POST: Create Booking with Overlap Check

app.post('/api/bookings', auth, async (req, res) => {
    try {
        const { hotelId, checkIn, nights } = req.body;
        if (!hotelId || !checkIn || !nights) return res.status(400).json({ error: "Missing required fields" });

        const startDate = new Date(checkIn);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + Number(nights));

        // Logic: Check if any existing booking overlaps with this date range
        const conflict = await Booking.findOne({
            hotelId: hotelId,
            $or: [{
                checkIn: { $lt: endDate },
                $expr: {
                    $gt: [
                        { $dateAdd: { startDate: "$checkIn", unit: "day", amount: "$nights" } },
                        startDate
                    ]
                }
            }]
        });

        if (conflict) {
            return res.status(400).json({ error: "Hotel is fully booked for these dates." });
        }

        const booking = new Booking({
            hotelId,
            userId: req.user.id,
            checkIn: startDate,
            nights: Number(nights),
            guests: req.body.guests || 1
        });

        await booking.save();
        res.status(201).json(booking);
    } catch (err) {
        res.status(500).json({ error: "Booking failed: " + err.message });
    }
});

// GET: All Bookings for Logged-in User

app.get('/api/bookings', auth, async (req, res) => {
    try {
        const bookings = await Booking.find({ userId: req.user.id }).populate('hotelId');
        res.json(bookings || []);
    } catch (err) {
        res.status(500).json({ error: "Could not fetch bookings" });
    }
});

// PATCH: Update Booking
app.patch('/api/bookings/:id', auth, async (req, res) => {
    try {
        const { guests, checkIn, nights } = req.body;
        const updateData = {};
        if (guests) updateData.guests = Number(guests);
        if (checkIn) updateData.checkIn = new Date(checkIn);
        if (nights) updateData.nights = Number(nights);

        const booking = await Booking.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        if (!booking) return res.status(404).json({ error: "Booking not found" });
        res.json({ message: "Updated successfully", booking });
    } catch (err) {
        res.status(500).json({ error: "Update failed" });
    }
});

// DELETE: Cancel Booking
app.delete('/api/bookings/:id', auth, async (req, res) => {
    try {
        await Booking.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.json({ message: "Booking deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET: Aggregated Stats for Homepage
app.get('/api/stats/cities', async (req, res) => {
    try {
        const stats = await Hotel.aggregate([
            {
                // Stage 1: Group by city and calculate totals
                $group: {
                    _id: "$city",
                    totalHotels: { $sum: 1 },
                    avgPrice: { $avg: "$price" }
                }
            },
            {
                // Stage 2: Sort by total hotels descending
                $sort: { totalHotels: -1 } 
            },
            {
                // Stage 3: Format the output
                $project: {
                    _id: 0,
                    city: "$_id",
                    totalHotels: 1,
                    avgPrice: { $round: ["$avgPrice", 2] }
                }
            }
        ]);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: "Aggregation failed: " + err.message });
    }
});

// 5. STATIC FILES (at the bottom)
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));