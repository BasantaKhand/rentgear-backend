require('dotenv').config();
const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');

// Sample equipment across all categories
const equipment = [
  {
    name: 'Sony A7 IV Mirrorless Camera',
    category: 'cameras',
    description: 'Full-frame 33MP sensor with 4K 60p video, ideal for professional photo and video shoots.',
    image: 'https://placehold.co/600x400?text=Sony+A7+IV',
    dailyRate: 75,
    quantity: 3,
    available: true,
  },
  {
    name: 'Canon EOS R5 Full Frame',
    category: 'cameras',
    description: '45MP full-frame sensor, 8K video recording and dual card slots for demanding productions.',
    image: 'https://placehold.co/600x400?text=Canon+EOS+R5',
    dailyRate: 95,
    quantity: 2,
    available: true,
  },
  {
    name: 'DeWalt 20V Drill Combo Kit',
    category: 'tools',
    description: 'Cordless drill and impact driver kit with two batteries, charger and carrying case.',
    image: 'https://placehold.co/600x400?text=DeWalt+Drill',
    dailyRate: 35,
    quantity: 5,
    available: true,
  },
  {
    name: 'Makita Circular Saw',
    category: 'tools',
    description: '7-1/4 inch circular saw with electric brake and dust blower for clean, precise cuts.',
    image: 'https://placehold.co/600x400?text=Makita+Saw',
    dailyRate: 28,
    quantity: 4,
    available: true,
  },
  {
    name: 'Trek Marlin 7 Mountain Bike',
    category: 'sports',
    description: 'Lightweight aluminum frame with hydraulic disc brakes, built for trail riding.',
    image: 'https://placehold.co/600x400?text=Trek+Mountain+Bike',
    dailyRate: 45,
    quantity: 3,
    available: true,
  },
  {
    name: 'Inflatable 2-Person Kayak',
    category: 'sports',
    description: 'Durable inflatable kayak with paddles, pump and seats for two.',
    image: 'https://placehold.co/600x400?text=Kayak',
    dailyRate: 40,
    quantity: 2,
    available: true,
  },
  {
    name: 'MacBook Pro 16 M3',
    category: 'electronics',
    description: 'M3 Pro chip with 18GB RAM, perfect for editing photos and video on location.',
    image: 'https://placehold.co/600x400?text=MacBook+Pro+16',
    dailyRate: 60,
    quantity: 3,
    available: true,
  },
  {
    name: 'iPad Pro 12.9 M2',
    category: 'electronics',
    description: '12.9-inch Liquid Retina XDR display with Apple Pencil support for creative work.',
    image: 'https://placehold.co/600x400?text=iPad+Pro',
    dailyRate: 35,
    quantity: 4,
    available: true,
  },
  {
    name: 'Shure SM7B Microphone',
    category: 'audio',
    description: 'Professional dynamic microphone ideal for podcasts, streaming and vocals.',
    image: 'https://placehold.co/600x400?text=Shure+SM7B',
    dailyRate: 25,
    quantity: 4,
    available: true,
  },
  {
    name: 'Rode Wireless GO II',
    category: 'audio',
    description: 'Compact dual-channel wireless microphone system with on-board recording.',
    image: 'https://placehold.co/600x400?text=Rode+Wireless',
    dailyRate: 30,
    quantity: 3,
    available: true,
  },
  {
    name: 'Aputure 600d Pro LED Light',
    category: 'lighting',
    description: 'Powerful 600W daylight LED with Bowens mount for studio and location lighting.',
    image: 'https://placehold.co/600x400?text=Aputure+600d',
    dailyRate: 65,
    quantity: 3,
    available: true,
  },
  {
    name: 'Godox SL60W LED Light',
    category: 'lighting',
    description: 'Affordable 60W daylight-balanced LED with silent cooling, great for interviews.',
    image: 'https://placehold.co/600x400?text=Godox+SL60',
    dailyRate: 30,
    quantity: 5,
    available: true,
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing equipment unless --keep is passed
    if (!process.argv.includes('--keep')) {
      const { deletedCount } = await Equipment.deleteMany({});
      console.log(`Cleared ${deletedCount} existing equipment item(s)`);
    }

    const created = await Equipment.insertMany(equipment);
    console.log(`Seeded ${created.length} equipment items successfully`);
  } catch (error) {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

seed();
