const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const editPostController = require('../controllers/editPostController');
const { requireAuth } = require('../middleware/authMiddleware');

// Links in the approval emails (no login; the signed token in the link is the proof).
router.get('/email-approve', postController.approvePostViaEmail);
router.get('/email-reject', postController.rejectPostViaEmail);

// Token-based routes used by edit.html (no login). Keep these above /:id routes.
router.get('/edit-data', editPostController.getEditData);
router.post('/edit-preview', editPostController.preview);
router.post('/edit-save', editPostController.save);
router.post('/edit-approve', editPostController.approve);
router.get('/edit-background-status', editPostController.backgroundStatus);
router.post('/edit-new-background', editPostController.newBackground);

// Dashboard routes (login required)
router.get('/', requireAuth, postController.listPosts);
router.get('/schedule-overview', requireAuth, postController.scheduleOverview);
router.get('/schedule-calendar', requireAuth, postController.scheduleCalendar);
router.post('/upload-image', requireAuth, postController.uploadImagePost);
router.post('/:id/schedule', requireAuth, postController.schedulePost);
router.patch('/:id/schedule', requireAuth, postController.reschedulePost);
router.post('/:id/unschedule', requireAuth, postController.unschedulePost);
router.post('/:id/retry', requireAuth, postController.retryScheduledPost);
router.post('/:id/back-to-generated', requireAuth, postController.movePostToGenerated);
router.post('/:id/approve', requireAuth, postController.approvePost);
router.post('/:id/reject', requireAuth, postController.rejectPost);
router.post('/:id/edit-link', requireAuth, editPostController.createEditLink);

module.exports = router;