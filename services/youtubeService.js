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

  let shortTitle = String(title || 'Short').trim();
  if (!/#shorts/i.test(shortTitle)) shortTitle += ' #Shorts';

  const status = {
    privacyStatus: publishAt ? 'private' : (privacy || 'private'),
    selfDeclaredMadeForKids: false
  };
  if (publishAt) status.publishAt = publishAt;

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: shortTitle.slice(0, 100),
        description: String(description || '') + '\n\n#Shorts',
        categoryId: '22'
      },
      status: status
    },
    media: { body: fs.createReadStream(filePath) }
  });
  return res.data.id;
}

module.exports = { authUrl, exchangeCode, uploadShort };