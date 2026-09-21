const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const { requireAuth } = require('../middleware/authMiddleware');

// Every route here requires a logged-in user — req.userId is set by
// requireAuth and used to scope all data to that specific person.
router.use(requireAuth);

router.post('/', campaignController.createCampaign);
router.get('/', campaignController.listCampaigns);
router.post('/:id/generate', campaignController.generateForCampaign);
router.post('/:id/themes', campaignController.setThemes);
router.get('/:id/themes', campaignController.getThemes);

module.exports = router;
