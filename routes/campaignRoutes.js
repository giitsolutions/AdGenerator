const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const { requireAuth } = require('../middleware/authMiddleware');

// Every route here requires a logged-in user
router.use(requireAuth);

router.post('/', campaignController.createCampaign);
router.get('/', campaignController.listCampaigns);

// Edit & Delete
router.put('/:id', campaignController.updateCampaign);
router.delete('/:id', campaignController.deleteCampaign);

router.post('/:id/generate', campaignController.generateForCampaign);
router.post('/:id/themes', campaignController.setThemes);
router.get('/:id/themes', campaignController.getThemes);

module.exports = router;