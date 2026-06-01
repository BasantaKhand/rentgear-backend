const mongoose = require('mongoose');

const equipmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Equipment name is required'],
    trim: true,
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['cameras', 'tools', 'sports', 'electronics', 'audio', 'lighting'],
  },
  description: {
    type: String,
    trim: true,
  },
  image: {
    type: String, // file path
    default: null,
  },
  dailyRate: {
    type: Number,
    required: [true, 'Daily rate is required'],
    min: 0,
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: 0,
    default: 1,
  },
  available: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Equipment', equipmentSchema);
