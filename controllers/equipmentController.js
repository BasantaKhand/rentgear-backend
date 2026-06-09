const Equipment = require('../models/Equipment');
const Booking = require('../models/Booking');
const { deleteUploadedFile } = require('../utils/helpers');

// @route  GET /api/equipment
// @desc   List equipment with filtering, search and pagination
// @access Public
exports.getEquipment = async (req, res, next) => {
  try {
    const { category, minPrice, maxPrice, available, search } = req.query;

    const filter = {};

    if (category) filter.category = category;

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.dailyRate = {};
      if (minPrice !== undefined) filter.dailyRate.$gte = Number(minPrice);
      if (maxPrice !== undefined) filter.dailyRate.$lte = Number(maxPrice);
    }

    if (available !== undefined) {
      filter.available = available === 'true';
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 12, 1);
    const skip = (page - 1) * limit;

    const [equipment, total] = await Promise.all([
      Equipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Equipment.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      count: equipment.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      equipment,
    });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/equipment/:id
// @desc   Get a single equipment item
// @access Public
exports.getEquipmentById = async (req, res, next) => {
  try {
    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) {
      return res
        .status(404)
        .json({ success: false, message: 'Equipment not found' });
    }
    return res.json({ success: true, equipment });
  } catch (error) {
    next(error);
  }
};

// @route  POST /api/equipment
// @desc   Create equipment (admin)
// @access Private/Admin
exports.createEquipment = async (req, res, next) => {
  try {
    const { name, category, description, dailyRate, quantity } = req.body;

    const image = req.file ? `/uploads/equipment/${req.file.filename}` : null;

    const equipment = await Equipment.create({
      name,
      category,
      description,
      dailyRate: Number(dailyRate),
      quantity: Number(quantity),
      image,
    });

    return res.status(201).json({ success: true, equipment });
  } catch (error) {
    next(error);
  }
};

// @route  PUT /api/equipment/:id
// @desc   Update equipment (admin)
// @access Private/Admin
exports.updateEquipment = async (req, res, next) => {
  try {
    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) {
      return res
        .status(404)
        .json({ success: false, message: 'Equipment not found' });
    }

    const { name, category, description, dailyRate, quantity, available } =
      req.body;

    if (name !== undefined) equipment.name = name;
    if (category !== undefined) equipment.category = category;
    if (description !== undefined) equipment.description = description;
    if (dailyRate !== undefined) equipment.dailyRate = Number(dailyRate);
    if (quantity !== undefined) equipment.quantity = Number(quantity);
    if (available !== undefined) {
      equipment.available =
        available === true || available === 'true';
    }

    // Replace image if a new one was uploaded
    if (req.file) {
      if (equipment.image) deleteUploadedFile(equipment.image);
      equipment.image = `/uploads/equipment/${req.file.filename}`;
    }

    await equipment.save();
    return res.json({ success: true, equipment });
  } catch (error) {
    next(error);
  }
};

// @route  DELETE /api/equipment/:id
// @desc   Delete equipment (admin)
// @access Private/Admin
exports.deleteEquipment = async (req, res, next) => {
  try {
    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) {
      return res
        .status(404)
        .json({ success: false, message: 'Equipment not found' });
    }

    if (equipment.image) deleteUploadedFile(equipment.image);
    await equipment.deleteOne();

    return res.json({ success: true, message: 'Equipment deleted' });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/equipment/:id/availability
// @desc   Check availability for a date range
// @access Public
exports.checkAvailability = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) {
      return res
        .status(404)
        .json({ success: false, message: 'Equipment not found' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate query params are required',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Bookings that overlap the requested range and are not cancelled
    const overlapping = await Booking.countDocuments({
      equipment: equipment._id,
      status: { $ne: 'cancelled' },
      startDate: { $lte: end },
      endDate: { $gte: start },
    });

    const quantityAvailable = Math.max(equipment.quantity - overlapping, 0);

    return res.json({
      success: true,
      available: quantityAvailable > 0 && equipment.available,
      quantityAvailable,
      totalQuantity: equipment.quantity,
    });
  } catch (error) {
    next(error);
  }
};

// @route  POST /api/equipment/seed
// @desc   Insert sample equipment (admin)
// @access Private/Admin
exports.seedEquipment = async (req, res, next) => {
  try {
    const samples = [
      {
        name: 'Sony A7 IV Mirrorless Camera',
        category: 'cameras',
        description: 'Full-frame 33MP sensor, 4K 60p video, ideal for pro shoots.',
        image: 'https://placehold.co/600x400?text=Sony+A7+IV',
        dailyRate: 75,
        quantity: 3,
      },
      {
        name: 'Canon EOS R5 Full Frame',
        category: 'cameras',
        description: '45MP sensor, 8K video recording, dual card slots.',
        image: 'https://placehold.co/600x400?text=Canon+R5',
        dailyRate: 95,
        quantity: 2,
      },
      {
        name: 'DeWalt 20V Drill Combo Kit',
        category: 'tools',
        description: 'Drill, impact driver, 2 batteries, charger and case.',
        image: 'https://placehold.co/600x400?text=DeWalt+Drill',
        dailyRate: 35,
        quantity: 5,
      },
      {
        name: 'Bosch Circular Saw',
        category: 'tools',
        description: '7-1/4 inch circular saw with laser guide.',
        image: 'https://placehold.co/600x400?text=Bosch+Saw',
        dailyRate: 28,
        quantity: 4,
      },
      {
        name: 'Trek Marlin 7 Mountain Bike',
        category: 'sports',
        description: 'Aluminum frame, hydraulic disc brakes, trail-ready.',
        image: 'https://placehold.co/600x400?text=Trek+Marlin+7',
        dailyRate: 45,
        quantity: 3,
      },
      {
        name: 'Kayak 2-Person Inflatable',
        category: 'sports',
        description: 'Durable inflatable kayak with paddles and pump.',
        image: 'https://placehold.co/600x400?text=Kayak',
        dailyRate: 40,
        quantity: 2,
      },
      {
        name: 'DJI Mavic 3 Pro Drone',
        category: 'electronics',
        description: 'Hasselblad camera, 43-min flight time.',
        image: 'https://placehold.co/600x400?text=DJI+Mavic+3',
        dailyRate: 120,
        quantity: 2,
      },
      {
        name: 'MacBook Pro 16 M3',
        category: 'electronics',
        description: 'M3 Pro chip, 18GB RAM, great for editing on location.',
        image: 'https://placehold.co/600x400?text=MacBook+Pro',
        dailyRate: 60,
        quantity: 3,
      },
      {
        name: 'Shure SM7B Microphone',
        category: 'audio',
        description: 'Professional dynamic mic for podcasts and streaming.',
        image: 'https://placehold.co/600x400?text=Shure+SM7B',
        dailyRate: 25,
        quantity: 4,
      },
      {
        name: 'Aputure 600d Pro LED Light',
        category: 'lighting',
        description: 'Daylight LED, Bowens mount, 600W output.',
        image: 'https://placehold.co/600x400?text=Aputure+600d',
        dailyRate: 65,
        quantity: 3,
      },
    ];

    // Replace existing sample set to keep seeding idempotent
    await Equipment.deleteMany({ name: { $in: samples.map((s) => s.name) } });
    const created = await Equipment.insertMany(samples);

    return res
      .status(201)
      .json({ success: true, count: created.length, equipment: created });
  } catch (error) {
    next(error);
  }
};
