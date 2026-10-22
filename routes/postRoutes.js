const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { requireAuth } = require('../middleware/authMiddleware');

// PUBLIC routes — clicked directly from an email inbox, no login
// possible there. Security comes from the signed token itself (see
// scheduler/scheduler.js for how these links are generated), not
// from a login session.
router.get('/email-approve', postController.approvePostViaEmail);
router.get('/email-reject', postController.rejectPostViaEmail);

// Edit page API (public/edit.html). Also token-protected: the token in the
// query string (?token=...) is the signed "edit" link from the email.
router.get('/edit-data', postController.getEditData);
router.post('/edit-preview', postController.renderEditPreview);
router.post('/edit-save', postController.saveEdit);
router.post('/edit-approve', postController.approveViaEditPage);
router.post('/edit-new-background', postController.startNewBackground);
router.get('/edit-background-status', postController.getBackgroundStatus);

router.use(requireAuth);

router.get('/', postController.listPosts);
router.get('/:id/edit-link', postController.getEditLink);
router.post('/:id/approve', postController.approvePost);
router.post('/:id/reject', postController.rejectPost);

module.exports = router;