const Equipment = require('../models/Equipment');
const Booking = require('../models/Booking');
const { deleteUploadedFile } = require('../utils/helpers');
const { escapeRegex } = require('../middleware/validator');

// Take the last value if a query param arrived as an array (parameter pollution)
const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v);
// Coerce to a finite number or return undefined (never NaN into a query).
const num = (v) => {
  const n = Number(one(v));
  return Number.isFinite(n) ? n : undefined;
};

// @route  GET /api/equipment
// @desc   List equipment with filtering, search and pagination
// @access Public
exports.getEquipment = async (req, res, next) => {
  try {
    const category = one(req.query.category);
    const available = one(req.query.available);
    const search = one(req.query.search);

    const filter = {};

    // Category is only accepted when it's a known enum value (string).
    if (typeof category === 'string' && category) filter.category = category;

    const minPrice = num(req.query.minPrice);
    const maxPrice = num(req.query.maxPrice);
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.dailyRate = {};
      if (minPrice !== undefined) filter.dailyRate.$gte = minPrice;
      if (maxPrice !== undefined) filter.dailyRate.$lte = maxPrice;
    }

    if (available !== undefined) {
      filter.available = available === 'true';
    }

    // Escape regex metacharacters and cap length to prevent ReDoS / injection.
    if (typeof search === 'string' && search.trim()) {
      const safe = escapeRegex(search.trim().slice(0, 100));
      filter.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { description: { $regex: safe, $options: 'i' } },
      ];
    }

    // Pagination is validated/clamped by middleware; re-clamp defensively here.
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 1000);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 100);
    const skip = (page - 1) * limit;

    const [equipment, total] = await Promise.all([
      Equipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
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

    req.setAudit?.('EQUIPMENT_CREATED', {
      resource: 'equipment',
      resourceId: equipment._id,
      details: { name: equipment.name, category: equipment.category },
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

    req.setAudit?.('EQUIPMENT_UPDATED', {
      resource: 'equipment',
      resourceId: equipment._id,
    });

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

    // Prevent deletion while there are active rentals
    const activeCount = await Booking.countDocuments({
      equipment: equipment._id,
      status: 'active',
    });
    if (activeCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete: ${activeCount} active booking(s) exist for this equipment`,
      });
    }

    // Warn (but allow) if there are pending bookings
    const pendingCount = await Booking.countDocuments({
      equipment: equipment._id,
      status: 'pending',
    });

    if (equipment.image) deleteUploadedFile(equipment.image);
    await equipment.deleteOne();

    req.setAudit?.('EQUIPMENT_DELETED', {
      resource: 'equipment',
      resourceId: equipment._id,
      details: { name: equipment.name },
    });

    return res.json({
      success: true,
      message: 'Equipment deleted',
      warning:
        pendingCount > 0
          ? `${pendingCount} pending booking(s) referenced this equipment`
          : undefined,
    });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/equipment/:id/history
// @desc   Rental history for an equipment item (admin)
// @access Private/Admin
exports.getEquipmentHistory = async (req, res, next) => {
  try {
    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) {
      return res
        .status(404)
        .json({ success: false, message: 'Equipment not found' });
    }

    const bookings = await Booking.find({ equipment: req.params.id })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      equipment,
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    next(error);
  }
};

// @route  PUT /api/equipment/:id/availability
// @desc   Quick toggle of availability (admin)
// @access Private/Admin
exports.toggleAvailability = async (req, res, next) => {
  try {
    const { available } = req.body;
    if (typeof available !== 'boolean') {
      return res
        .status(400)
        .json({ success: false, message: 'available (boolean) is required' });
    }

    const equipment = await Equipment.findByIdAndUpdate(
      req.params.id,
      { available },
      { new: true }
    );
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

// @route  POST /api/equipment/bulk-update
// @desc   Update multiple equipment items (admin)
// @access Private/Admin
exports.bulkUpdate = async (req, res, next) => {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: 'ids must be a non-empty array' });
    }
    if (!updates || typeof updates !== 'object') {
      return res
        .status(400)
        .json({ success: false, message: 'updates object is required' });
    }

    // Whitelist updatable fields
    const allowed = ['available', 'category', 'dailyRate', 'quantity', 'description'];
    const sanitized = {};
    Object.keys(updates).forEach((k) => {
      if (allowed.includes(k)) sanitized[k] = updates[k];
    });

    const result = await Equipment.updateMany(
      { _id: { $in: ids } },
      { $set: sanitized }
    );

    return res.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

// @route  DELETE /api/equipment/bulk-delete
// @desc   Delete multiple equipment items (admin), skipping any with active bookings
// @access Private/Admin
exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: 'ids must be a non-empty array' });
    }

    const items = await Equipment.find({ _id: { $in: ids } });
    const deleted = [];
    const skipped = [];

    for (const item of items) {
      const activeCount = await Booking.countDocuments({
        equipment: item._id,
        status: 'active',
      });
      if (activeCount > 0) {
        skipped.push({ id: item._id, reason: 'has active bookings' });
        continue;
      }
      if (item.image) deleteUploadedFile(item.image);
      await item.deleteOne();
      deleted.push(item._id);
    }

    return res.json({
      success: true,
      deletedCount: deleted.length,
      deleted,
      skipped,
    });
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
