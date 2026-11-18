const secret = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(secret)) {
  const showStatus = message => {
    const status = document.getElementById('status');
    if (status) status.textContent = message;
    else location.replace('/local-connect');
  };
  history.replaceState(null, '', '/');
  fetch('/local-session', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret },
  }).then(async response => {
    if (!response.ok) {
      showStatus('链接无效，请使用启动器给出的访问链接。');
      return;
    }
    const { socketSecret } = await response.json();
    sessionStorage.setItem('carb.localSocketToken', socketSecret);
    location.reload();
  }).catch(() => {
    showStatus('连接失败，请确认本机工作台仍在运行。');
  });
} else if (document.currentScript?.defer === false && !sessionStorage.getItem('carb.localSocketToken')) {
  location.replace('/local-connect');
}
