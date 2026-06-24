const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const {
  getEquipment,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  checkAvailability,
  seedEquipment,
  getEquipmentHistory,
  toggleAvailability,
  bulkUpdate,
  bulkDelete,
} = require('../controllers/equipmentController');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const validate = require('../middleware/validate');
const { uploadEquipment, handleUpload } = require('../middleware/upload');

const CATEGORIES = ['cameras', 'tools', 'sports', 'electronics', 'audio', 'lighting'];

// Public: list with filters + pagination
router.get('/', getEquipment);

// Admin: seed sample data (declared before "/:id" so it isn't treated as an id)
router.post('/seed', auth, admin, seedEquipment);

// Admin: bulk operations (declared before "/:id" routes)
router.post('/bulk-update', auth, admin, bulkUpdate);
router.delete('/bulk-delete', auth, admin, bulkDelete);

// Admin: rental history + availability toggle
router.get('/:id/history', auth, admin, getEquipmentHistory);
router.put('/:id/availability', auth, admin, toggleAvailability);

// Public: availability check for a date range
router.get('/:id/availability', checkAvailability);

// Public: single item
router.get('/:id', getEquipmentById);

// Admin: create with image upload
router.post(
  '/',
  auth,
  admin,
  handleUpload(uploadEquipment.single('image')),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('category')
      .isIn(CATEGORIES)
      .withMessage(`Category must be one of: ${CATEGORIES.join(', ')}`),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('dailyRate')
      .isFloat({ min: 0 })
      .withMessage('Daily rate must be a positive number'),
    body('quantity')
      .isInt({ min: 0 })
      .withMessage('Quantity must be a non-negative integer'),
  ],
  validate,
  createEquipment
);

// Admin: update with optional new image
router.put(
  '/:id',
  auth,
  admin,
  handleUpload(uploadEquipment.single('image')),
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('category')
      .optional()
      .isIn(CATEGORIES)
      .withMessage(`Category must be one of: ${CATEGORIES.join(', ')}`),
    body('dailyRate')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Daily rate must be a positive number'),
    body('quantity')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Quantity must be a non-negative integer'),
  ],
  validate,
  updateEquipment
);

// Admin: delete
router.delete('/:id', auth, admin, deleteEquipment);

module.exports = router;
