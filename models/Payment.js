const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const paymentSchema = new mongoose.Schema({
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true,
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: 0,
  },
  method: {
    type: String,
    enum: ['card', 'cash'],
    required: [true, 'Payment method is required'],
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending',
  },
  transactionId: {
    type: String,
    default: null,
    set: encrypt, // encrypted at rest
    get: decrypt,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Ensure the transaction id is decrypted when serialized.
paymentSchema.set('toJSON', { getters: true });
paymentSchema.set('toObject', { getters: true });

module.exports = mongoose.model('Payment', paymentSchema);
