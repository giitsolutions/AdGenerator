const fs = require('fs');
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
];

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
}

function authUrl(state) {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: state
  });
}

async function exchangeCode(code) {
  const { tokens } = await oauthClient().getToken(code);
  return tokens;
}

// If publishAt is given, the video is uploaded as private and YouTube makes it public at that time.
async function uploadShort({ tokens, filePath, title, description, privacy, publishAt }) {
  const client = oauthClient();
  client.setCredentials(tokens);
  const youtube = google.youtube({ version: 'v3', auth: client });

  // The title stays clean. A hashtag in the title would replace the ones
  // shown above it, so #Shorts goes into the description instead.
  const shortTitle = String(title || 'Short').replace(/#shorts/gi, '').replace(/\s+/g, ' ').trim() || 'Short';

  let fullDescription = String(description || '').trim();
  if (!/#shorts/i.test(fullDescription)) fullDescription += '\n\n#Shorts';

  const status = {
    privacyStatus: publishAt ? 'private' : (privacy || 'public'),
    selfDeclaredMadeForKids: false
  };
  if (publishAt) status.publishAt = publishAt;

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: shortTitle.slice(0, 100),
        description: fullDescription.slice(0, 5000),
        categoryId: '22'
      },
      status: status
    },
    media: { body: fs.createReadStream(filePath) }
  });
  return res.data.id;
}

module.exports = { authUrl, exchangeCode, uploadShort };