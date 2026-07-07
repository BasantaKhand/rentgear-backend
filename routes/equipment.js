const express = require('express');
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
const { authorize } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { uploadEquipment, handleUpload, processUpload } = require('../middleware/upload');
const {
  equipmentCreateRules,
  equipmentUpdateRules,
  paginationRules,
  isValidObjectId,
} = require('../middleware/validator');

// Admin-only guard (logs unauthorized attempts)
const admin = authorize('admin');

// Public: list with filters + pagination
router.get('/', paginationRules, validate, getEquipment);

// Admin: seed sample data (declared before "/:id" so it isn't treated as an id)
router.post('/seed', auth, admin, seedEquipment);

// Admin: bulk operations (declared before "/:id" routes)
router.post('/bulk-update', auth, admin, bulkUpdate);
router.delete('/bulk-delete', auth, admin, bulkDelete);

// Admin: rental history + availability toggle
router.get('/:id/history', auth, admin, isValidObjectId('id'), getEquipmentHistory);
router.put('/:id/availability', auth, admin, isValidObjectId('id'), toggleAvailability);

// Public: availability check for a date range
router.get('/:id/availability', isValidObjectId('id'), checkAvailability);

// Public: single item
router.get('/:id', isValidObjectId('id'), getEquipmentById);

// Admin: create with image upload
router.post(
  '/',
  auth,
  admin,
  handleUpload(uploadEquipment.single('image')),
  processUpload('equipment'),
  equipmentCreateRules,
  validate,
  createEquipment
);

// Admin: update with optional new image
router.put(
  '/:id',
  auth,
  admin,
  isValidObjectId('id'),
  handleUpload(uploadEquipment.single('image')),
  processUpload('equipment'),
  equipmentUpdateRules,
  validate,
  updateEquipment
);

// Admin: delete
router.delete('/:id', auth, admin, isValidObjectId('id'), deleteEquipment);

module.exports = router;
