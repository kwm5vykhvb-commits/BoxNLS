async function test() {
  const res = await global.fetch('http://localhost:3000/api/download/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: "https://video.sibnet.ru/shell.php?videoid=4943016",
      title: "Black_Torch_Test",
      format: "mp4",
      quality: "360p",
      referer: "https://anime-sama.to/"
    })
  });
  const data = await res.json();
  console.log(data);
  const jobId = data.jobId;
  
  let attempts = 0;
  while(attempts < 15) {
    await new Promise(r => setTimeout(r, 2000));
    const sRes = await global.fetch(`http://localhost:3000/api/download/status/${jobId}`);
    const sData = await sRes.json();
    console.log(sData.status, sData.progress, sData.error);
    if(sData.status === 'error' || sData.status === 'completed') break;
    attempts++;
  }
}
test();
