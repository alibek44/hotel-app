const mongoose = require('mongoose');

// USER SCHEMA
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' } // 'user' or 'admin'
});

// HOTEL SCHEMA
const hotelSchema = new mongoose.Schema({
    name: { type: String, required: true },
    city: { type: String, required: true },
    price: { type: Number, required: true },
    amenities: [String],
    reviews: [{
        username: String,
        comment: String,
        rating: Number,
        date: { type: Date, default: Date.now }
    }]
});
hotelSchema.index({ city: 1, price: 1 });
// BOOKING SCHEMA (Critical for the Fix)
const bookingSchema = new mongoose.Schema({
    hotelId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Hotel', 
        required: true 
    },
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    checkIn: { 
        type: Date, 
        required: true 
    },
    nights: { 
        type: Number, 
        required: true, 
        default: 1,
        min: 1 
    },
    guests: { 
        type: Number, 
        default: 1 
    }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Hotel = mongoose.model('Hotel', hotelSchema);
const Booking = mongoose.model('Booking', bookingSchema);

module.exports = { User, Hotel, Booking };