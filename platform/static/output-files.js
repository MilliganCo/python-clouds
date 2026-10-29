/* Downloads belong to the visible run; bytes never become HTML or remote URLs. */
window.OutputFiles = (function () {
  let version = 0;
  const mounted = new Map();
  const types = {xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png'};
  function clear(host) {
    const record = mounted.get(host);
    if (!record) return;
    record.urls.forEach(url => URL.revokeObjectURL(url));
    record.block.remove();
    mounted.delete(host);
  }
  function clearAll() {
    version++;
    [...mounted.keys()].forEach(clear);
  }
  function show(host, files, epoch = version) {
    clear(host);
    if (!host?.isConnected || epoch !== version || !Array.isArray(files) || !files.length || files.length > 3) return;
    const prepared = [];
    let total = 0;
    const names = new Set();
    for (const item of files) {
      const name = item?.name, extension = typeof name === 'string' ? name.split('.').pop().toLowerCase() : '';
      if (typeof name !== 'string' || name.length > 100 || name !== name.trim() || !name || name.startsWith('.') || /[\x00-\x1f\x7f/\\:*?"<>|]/.test(name) || !Object.hasOwn(types,extension) || names.has(name.toLowerCase()) || typeof item.data !== 'string' || item.data.length > 349528) return;
      let decoded;
      try { decoded = atob(item.data); } catch (_) { return; }
      total += decoded.length;
      if (!decoded.length || decoded.length > 262144 || total > 524288) return;
      names.add(name.toLowerCase());
      const preview=extension==='png' && item.preview && Number.isInteger(item.preview.width) && Number.isInteger(item.preview.height)
        && item.preview.width>0 && item.preview.height>0 && item.preview.width<=4096 && item.preview.height<=4096
        && item.preview.width*item.preview.height<=4000000 ? item.preview : null;
      const description=typeof item.description==='string' ? item.description.slice(0,500) : '';
      prepared.push({name,mime:types[extension],bytes:Uint8Array.from(decoded,c=>c.charCodeAt(0)),preview,description});
    }
    const block = document.createElement('div');
    block.className = 'output-files';
    block.setAttribute('role','region');
    block.setAttribute('aria-label','Файлы этого запуска');
    const caption = document.createElement('p');
    caption.textContent = 'Файлы этого запуска — скачайте до перехода на другую страницу';
    block.append(caption);
    const urls = [];
    for (const file of prepared) {
      const url = URL.createObjectURL(new Blob([file.bytes],{type:file.mime}));
      urls.push(url);
      if (file.preview) {
        const figure=document.createElement('figure'),image=document.createElement('img'),label=document.createElement('figcaption');
        figure.className='output-plot';
        image.src=url;image.alt=file.description || `График из файла ${file.name}`;
        image.loading='lazy';image.decoding='async';
        image.width=file.preview.width;image.height=file.preview.height;
        label.textContent=file.name;
        image.addEventListener('error',()=>{image.remove();label.textContent=`Предпросмотр ${file.name} недоступен; файл можно скачать.`;},{once:true});
        figure.append(image,label);block.append(figure);
      }
      const link = document.createElement('a');
      link.className = 'btn output-file';
      link.href = url;
      link.download = file.name;
      link.textContent = `Скачать ${file.name} · ${Math.max(1,Math.ceil(file.bytes.length/1024))} КиБ`;
      block.append(link);
    }
    host.after(block);
    mounted.set(host,{block,urls});
  }
  window.addEventListener('hashchange',clearAll);
  window.addEventListener('pagehide',clearAll);
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      for (const host of mounted.keys()) if (!host.isConnected) clear(host);
    }).observe(document.documentElement,{childList:true,subtree:true});
  }
  return Object.freeze({show,clear,clearAll,epoch:()=>version});
})();
