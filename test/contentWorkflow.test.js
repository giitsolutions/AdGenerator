const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwikpost-workflow-'));
process.env.DB_PATH = path.join(tempDir, 'workflow.db');

const { getDb } = require('../db/connection');
const { ensureReelColumns } = require('../db/reelMigration');
const { ensureContentWorkflowSchema } = require('../db/contentWorkflowMigration');
const postModel = require('../models/postModel');
const scheduleStore = require('../models/scheduleStore');
const postController = require('../controllers/postController');

test('content transitions persist valid states and reject invalid transitions', async () => {
  const db = await getDb();
  try {
    await ensureReelColumns();
    await ensureContentWorkflowSchema();
    const user = await db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      ['workflow-test@example.test', 'test-hash']
    );
    const campaign = await db.run(
      'INSERT INTO campaigns (user_id, product_name) VALUES (?, ?)',
      [user.lastID, 'Workflow test']
    );

    const imageId = await postModel.createPost({
      userId: user.lastID,
      campaignId: campaign.lastID,
      caption: 'Image post',
      hashtags: [],
      cta: '',
      mediaType: 'image'
    });
    const reelId = await postModel.createPost({
      userId: user.lastID,
      campaignId: campaign.lastID,
      caption: 'Reel post',
      hashtags: [],
      cta: '',
      mediaType: 'reel',
      videoUrl: '/uploads/reels/test.mp4'
    });

    assert.equal((await postModel.getPostById(imageId, user.lastID)).status, 'generated');
    assert.equal((await postModel.getPostById(reelId, user.lastID)).content_type, 'reel');
    await assert.rejects(
      postModel.schedulePostAt(imageId, user.lastID, new Date(Date.now() + 60000).toISOString()),
      { code: 'INVALID_STATUS_TRANSITION', status: 409 }
    );

    await postModel.updatePostContent(imageId, user.lastID, {
      caption: 'Edited image post',
      hashtags: [],
      cta: '',
      headlineMain: 'Edited image',
      headlineAccent: '',
      subheadline: '',
      offerText: '',
      ctaButtonLabel: '',
      layoutIndex: 0,
      imageUrl: '/uploads/images/edited.png'
    });
    await assert.rejects(
      postModel.markReadyToPost(imageId, user.lastID),
      { code: 'INVALID_STATUS_TRANSITION', status: 409 }
    );
    const staleScheduleAt = new Date(Date.now() - 60000).toISOString();
    await postModel.schedulePostAt(imageId, user.lastID, staleScheduleAt);
    const rescheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await scheduleStore.reschedulePost(imageId, user.lastID, rescheduledAt);
    let post = await postModel.getPostById(imageId, user.lastID);
    assert.equal(post.status, 'scheduled');
    assert.equal(post.scheduled_at, rescheduledAt);
    assert.equal(await scheduleStore.markPublishing(imageId, staleScheduleAt), 0);
    await assert.rejects(
      postModel.reschedulePostAt(imageId, user.lastID, new Date(Date.now() - 1000).toISOString()),
      { status: 400 }
    );
    await db.run(
      'UPDATE posts SET publish_lock_until = ? WHERE id = ?',
      [new Date(Date.now() + 60000).toISOString(), imageId]
    );
    await assert.rejects(
      postModel.reschedulePostAt(imageId, user.lastID, new Date(Date.now() + 10 * 60 * 1000).toISOString()),
      { code: 'POST_PUBLISH_IN_PROGRESS', status: 409 }
    );
    await db.run(
      'UPDATE posts SET publish_lock_until = ? WHERE id = ?',
      [new Date(Date.now() - 60000).toISOString(), imageId]
    );
    const afterExpiredLock = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await postModel.reschedulePostAt(imageId, user.lastID, afterExpiredLock);
    assert.equal((await postModel.getPostById(imageId, user.lastID)).scheduled_at, afterExpiredLock);
    await assert.rejects(
      postModel.markReadyToPost(imageId, user.lastID),
      { code: 'INVALID_STATUS_TRANSITION', status: 409 }
    );

    await postModel.markAsFailed(imageId, 'temporary publish failure');
    post = await postModel.getPostById(imageId, user.lastID);
    assert.equal(post.status, 'scheduled');
    assert.equal(post.last_error, 'temporary publish failure');
    let calendarPosts = await postModel.getAllPosts(user.lastID, {
      contentType: 'image',
      statuses: ['scheduled', 'posted'],
      dateRange: {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000),
        to: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    assert.deepEqual(calendarPosts.map(item => item.id), [imageId]);
    await postModel.markAsPosted(imageId, user.lastID);
    post = await postModel.getPostById(imageId, user.lastID);
    assert.equal(post.status, 'posted');
    assert.ok(post.posted_at);
    assert.equal(new Date(post.posted_at).toISOString(), post.posted_at);
    await assert.rejects(
      postModel.reschedulePostAt(imageId, user.lastID, new Date(Date.now() + 10 * 60 * 1000).toISOString()),
      { code: 'INVALID_STATUS_TRANSITION', status: 409 }
    );
    calendarPosts = await postModel.getAllPosts(user.lastID, {
      contentType: 'image',
      statuses: ['scheduled', 'posted'],
      dateRange: {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000),
        to: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    assert.deepEqual(calendarPosts.map(item => item.id), [imageId]);

    await postModel.updateReelContent(reelId, user.lastID, {
      caption: 'Edited reel',
      hashtags: [],
      cta: '',
      headlineMain: 'Edited video',
      videoUrl: '/uploads/reels/edited.mp4'
    });
    await assert.rejects(
      postModel.reschedulePostAt(reelId, user.lastID, new Date(Date.now() + 10 * 60 * 1000).toISOString()),
      { code: 'INVALID_STATUS_TRANSITION', status: 409 }
    );
    await postModel.schedulePostAt(reelId, user.lastID, new Date(Date.now() + 60000).toISOString());
    await postModel.unschedulePost(reelId, user.lastID);
    assert.equal((await postModel.getPostById(reelId, user.lastID)).status, 'ready_to_post');
    await postModel.movePostToGenerated(reelId, user.lastID);
    assert.equal((await postModel.getPostById(reelId, user.lastID)).status, 'generated');
    await assert.rejects(
      postModel.movePostToGenerated(reelId, user.lastID),
      { code: 'INVALID_STATUS_TRANSITION', status: 409 }
    );
    await postModel.markReadyToPost(reelId, user.lastID);
    assert.equal((await postModel.getAllPosts(user.lastID, { contentType: 'image' })).length, 1);
    assert.equal((await postModel.getAllPosts(user.lastID, { contentType: 'reel' })).length, 1);
    assert.equal((await postModel.getAllPosts(user.lastID, { status: 'posted' })).length, 1);

    const lifecycleImageId = await postModel.createPost({
      userId: user.lastID,
      campaignId: campaign.lastID,
      caption: 'Lifecycle image',
      hashtags: [],
      cta: '',
      mediaType: 'image'
    });
    await postModel.updatePostContent(lifecycleImageId, user.lastID, {
      caption: 'Edited lifecycle image',
      hashtags: [],
      cta: '',
      headlineMain: 'Lifecycle image',
      headlineAccent: '',
      subheadline: '',
      offerText: '',
      ctaButtonLabel: '',
      layoutIndex: 0,
      imageUrl: '/uploads/images/lifecycle.png'
    });
    await postModel.schedulePostAt(lifecycleImageId, user.lastID, new Date(Date.now() + 60000).toISOString());
    await scheduleStore.reschedulePost(
      lifecycleImageId,
      user.lastID,
      new Date(Date.now() + 5 * 60 * 1000).toISOString()
    );
    await postModel.markAsPosted(lifecycleImageId, user.lastID);
    assert.equal((await postModel.getPostById(lifecycleImageId, user.lastID)).status, 'posted');

    const lifecycleReelId = await postModel.createPost({
      userId: user.lastID,
      campaignId: campaign.lastID,
      caption: 'Lifecycle reel',
      hashtags: [],
      cta: '',
      mediaType: 'reel',
      videoUrl: '/uploads/reels/lifecycle.mp4'
    });
    await postModel.updateReelContent(lifecycleReelId, user.lastID, {
      caption: 'Edited lifecycle reel',
      hashtags: [],
      cta: '',
      headlineMain: 'Lifecycle reel',
      videoUrl: '/uploads/reels/lifecycle-edited.mp4'
    });
    await postModel.schedulePostAt(lifecycleReelId, user.lastID, new Date(Date.now() + 60000).toISOString());
    await scheduleStore.reschedulePost(
      lifecycleReelId,
      user.lastID,
      new Date(Date.now() + 5 * 60 * 1000).toISOString()
    );
    await postModel.markAsPosted(lifecycleReelId, user.lastID);
    assert.equal((await postModel.getPostById(lifecycleReelId, user.lastID)).status, 'posted');

    const rejectFilename = `workflow-reject-${process.pid}-${Date.now()}.mp4`;
    const sourceFilename = `${path.parse(rejectFilename).name}-source.mp4`;
    const reelDirectory = path.join(__dirname, '..', 'public', 'uploads', 'reels');
    const sourceDirectory = path.join(__dirname, '..', 'storage', 'reel-sources');
    fs.mkdirSync(reelDirectory, { recursive: true });
    fs.mkdirSync(sourceDirectory, { recursive: true });
    const rejectedVideoPath = path.join(reelDirectory, rejectFilename);
    const rejectedSourcePath = path.join(sourceDirectory, sourceFilename);
    fs.writeFileSync(rejectedVideoPath, 'test video');
    fs.writeFileSync(rejectedSourcePath, 'test source');
    const rejectedReelIds = [];
    try {
      for (let index = 0; index < 2; index++) {
        rejectedReelIds.push(await postModel.createPost({
          userId: user.lastID,
          campaignId: campaign.lastID,
          caption: 'Generated reel to reject',
          hashtags: [],
          cta: '',
          mediaType: 'reel',
          videoUrl: `/uploads/reels/${rejectFilename}`,
          videoSourceUrl: sourceFilename
        }));
      }

      await postController.performRejection(rejectedReelIds[0], user.lastID);
      assert.equal(await postModel.getPostById(rejectedReelIds[0], user.lastID), undefined);
      assert.equal(fs.existsSync(rejectedVideoPath), true);
      assert.equal(fs.existsSync(rejectedSourcePath), true);

      await postController.performRejection(rejectedReelIds[1], user.lastID);
      assert.equal(await postModel.getPostById(rejectedReelIds[1], user.lastID), undefined);
      assert.equal(fs.existsSync(rejectedVideoPath), false);
      assert.equal(fs.existsSync(rejectedSourcePath), false);
    } finally {
      fs.rmSync(rejectedVideoPath, { force: true });
      fs.rmSync(rejectedSourcePath, { force: true });
    }

    const existingPreviewFilename = `workflow-preview-${process.pid}-${Date.now()}.mp4`;
    const existingPreviewPath = path.join(reelDirectory, existingPreviewFilename);
    fs.writeFileSync(existingPreviewPath, 'test video');
    let existingPreviewId;
    let missingPreviewId;
    try {
      existingPreviewId = await postModel.createPost({
        userId: user.lastID,
        campaignId: campaign.lastID,
        caption: 'Reel with available preview',
        hashtags: [],
        cta: '',
        mediaType: 'reel',
        videoUrl: `/uploads/reels/${existingPreviewFilename}`
      });
      missingPreviewId = await postModel.createPost({
        userId: user.lastID,
        campaignId: campaign.lastID,
        caption: 'Reel with missing preview',
        hashtags: [],
        cta: '',
        mediaType: 'reel',
        videoUrl: `/uploads/reels/workflow-missing-${process.pid}-${Date.now()}.mp4`
      });

      let listedPosts;
      await postController.listPosts(
        { userId: user.lastID, query: { content_type: 'reel' } },
        { json(posts) { listedPosts = posts; } },
        error => { throw error; }
      );
      assert.equal(listedPosts.find(row => row.id === existingPreviewId).video_available, true);
      assert.equal(listedPosts.find(row => row.id === missingPreviewId).video_available, false);
    } finally {
      fs.rmSync(existingPreviewPath, { force: true });
    }

    const legacyIds = {};
    for (const status of ['draft', 'approved', 'scheduled', 'published', 'rejected']) {
      const result = await db.run(
        `INSERT INTO posts (campaign_id, user_id, status, scheduled_at, media_type, video_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          campaign.lastID,
          user.lastID,
          status,
          status === 'scheduled' ? new Date(Date.now() + 60000).toISOString() : null,
          status === 'draft' ? 'reel' : 'image',
          status === 'draft' ? '/uploads/reels/legacy.mp4' : null
        ]
      );
      legacyIds[status] = result.lastID;
    }

    await ensureContentWorkflowSchema();
    const expectedStates = {
      draft: 'generated',
      approved: 'ready_to_post',
      scheduled: 'scheduled',
      published: 'posted',
      rejected: 'generated'
    };
    for (const [legacy, expected] of Object.entries(expectedStates)) {
      const row = await db.get('SELECT status, content_type, posted_at, created_at FROM posts WHERE id = ?', [legacyIds[legacy]]);
      assert.equal(row.status, expected);
      assert.equal(row.content_type, legacy === 'draft' ? 'reel' : 'image');
      if (legacy === 'published') {
        assert.ok(row.posted_at.endsWith('Z'));
        assert.equal(new Date(row.posted_at).toISOString(), row.posted_at);
      }
    }
    await ensureContentWorkflowSchema();
    const legacyImages = await postModel.getAllPosts(user.lastID, { contentType: 'image' });
    const legacyReels = await postModel.getAllPosts(user.lastID, { contentType: 'reel' });
    assert.ok(legacyImages.some(row => row.id === legacyIds.published && row.status === 'posted'));
    assert.ok(legacyReels.some(row => row.id === legacyIds.draft && row.status === 'generated'));
    const legacyCalendar = await postModel.getAllPosts(user.lastID, {
      contentType: 'image',
      statuses: ['scheduled', 'posted'],
      dateRange: {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000),
        to: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    assert.ok(legacyCalendar.some(row => row.id === legacyIds.published && row.status === 'posted'));
    assert.equal(
      await db.get('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?', [user.lastID]).then(row => row.count),
      11
    );
  } finally {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
