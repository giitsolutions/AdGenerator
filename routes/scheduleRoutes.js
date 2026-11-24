const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const postController = require('../controllers/postController');
const schedulerService = require('../services/schedulerService');

schedulerService.setPerformApproval(postController.performApproval);
// Lets the auto-poster share the Story after a scheduled post publishes
schedulerService.setPerformStory(postController.performStory);

router.post('/:id/schedule', requireAuth, postController.schedulePost);
router.post('/:id/unschedule', requireAuth, postController.unschedulePost);
router.post('/:id/retry', requireAuth, postController.retryScheduledPost);

function startAutoPoster() {
  schedulerService.startAutoPoster();
}

module.exports = {
  router,
  startAutoPoster,
  setPerformApproval: schedulerService.setPerformApproval
};