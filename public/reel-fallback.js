const guessIdea = () => {
	const textarea = document.querySelector('textarea');
	return textarea ? textarea.value.trim() : '';
};


const pick = (meta, keys) => {
	if (!meta) return '';
	for (const key of keys) {
		if (typeof meta[key] === 'string' && meta[key].trim()) return meta[key].trim();
	}
	return '';
};

async function fallback(cid, duration, auth, idea) {
	const requestBody = JSON.stringify({
		campaign_id: cid,
		duration: Number(duration) || 15,
		idea: idea || ''
	});
	return requestBody;
}

const getIdea = meta =>
	pick(meta, ['idea', 'prompt', 'video_idea', 'videoIdea', 'description']) || guessIdea();
