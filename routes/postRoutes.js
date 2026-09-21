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

router.use(requireAuth);

router.get('/', postController.listPosts);
router.post('/:id/approve', postController.approvePost);
router.post('/:id/reject', postController.rejectPost);

module.exports = router;
