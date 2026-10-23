const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const editPostController = require('../controllers/editPostController');
const { requireAuth } = require('../middleware/authMiddleware');

// Token-based routes used by edit.html (no login). Keep these above /:id routes.
router.get('/edit-data', editPostController.getEditData);
router.post('/edit-preview', editPostController.preview);
router.post('/edit-save', editPostController.save);
router.post('/edit-approve', editPostController.approve);
router.get('/edit-background-status', editPostController.backgroundStatus);
router.post('/edit-new-background', editPostController.newBackground);

// Dashboard routes (login required)
router.get('/', requireAuth, postController.listPosts);
router.post('/:id/approve', requireAuth, postController.approvePost);
router.post('/:id/reject', requireAuth, postController.rejectPost);
router.post('/:id/update-image', requireAuth, postController.updatePostImage);
router.post('/:id/edit-link', requireAuth, editPostController.createEditLink);

module.exports = router;