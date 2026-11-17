import { getLanguage } from './test-i18n.js';

const names = [
  '透明投影', '咪咪咪', '简约水投影', '野餐懒羊羊', '翻滚外星猫', '飞鸡',
  '初梦若雨', '碧蓝晴空', '匿名小兔', '透明人群', '蛋蛋', '呆猫迷糊脸',
  '洛天依', '呆萌蓝毛', '丹青渡', '透明花蚊子', '开心呆猫脸', '简约小透明',
];
export const avatarPresets = names.map((name, index) => {
  const id = String(index + 1).padStart(2, '0');
  return { id, name, source: new URL(`./avatars/${id}.webp`, import.meta.url).href };
});
const presetKey = 'carb.profile.lastAvatarPreset';
const presetData = new Map();
const text = (en, zh) => getLanguage() === 'en' ? en : zh;

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result) : reject(new Error(text('The image could not be read.', '无法读取这张图片。')));
    reader.onerror = () => reject(new Error(text('The image could not be read.', '无法读取这张图片。')));
    reader.readAsDataURL(blob);
  });
}

function loadPreset(preset) {
  if (!presetData.has(preset.id)) {
    const request = fetch(preset.source).then(response => {
      if (!response.ok) throw new Error(text('The avatar could not be loaded.', '无法加载头像，请重试。'));
      return response.blob();
    }).then(blob => readDataUrl(new Blob([blob], { type: 'image/webp' }))).catch(error => {
      presetData.delete(preset.id);
      throw error;
    });
    presetData.set(preset.id, request);
  }
  return presetData.get(preset.id);
}

async function readUpload(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error(text('Choose a PNG, JPEG, or WebP image.', '请选择 PNG、JPEG 或 WebP 图片。'));
  }
  if (file.size > 1048576) throw new Error(text('Choose an image smaller than 1 MB.', '请选择小于 1 MB 的图片。'));
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const valid = file.type === 'image/png'
    ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : file.type === 'image/jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!valid) throw new Error(text('This file is not a valid image.', '这个文件不是有效的图片。'));
  const dataUrl = await readDataUrl(file);
  await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth && image.naturalHeight
      ? resolve() : reject(new Error(text('This file is not a valid image.', '这个文件不是有效的图片。')));
    image.onerror = () => reject(new Error(text('This file is not a valid image.', '这个文件不是有效的图片。')));
    image.src = dataUrl;
  });
  return dataUrl;
}

function rememberPreset(id) {
  try {
    id ? localStorage.setItem(presetKey, id) : localStorage.removeItem(presetKey);
  } catch {}
}

export function createProfilePicker(React, jsx, GeneratedAvatar) {
  return function ProfilePicker({ identity, onChange, name }) {
    const currentImage = identity?.avatarDataUrl;
    const [selected, setSelected] = React.useState(currentImage ? 'custom' : 'generated');
    const [pending, setPending] = React.useState('');
    const [error, setError] = React.useState('');
    const fileInput = React.useRef(null);
    const request = React.useRef(0);
    const galleryId = React.useId();
    const statusId = React.useId();

    React.useEffect(() => {
      let active = true;
      if (!currentImage) {
        setSelected('generated');
        return () => { active = false; };
      }
      let lastPreset;
      try { lastPreset = localStorage.getItem(presetKey); } catch {}
      const preset = avatarPresets.find(avatar => avatar.id === lastPreset);
      setSelected('custom');
      if (preset) loadPreset(preset).then(dataUrl => {
        if (active && dataUrl === currentImage) setSelected(preset.id);
      }).catch(() => {});
      return () => { active = false; };
    }, [currentImage]);

    async function choose(preset) {
      const revision = ++request.current;
      setPending(preset.id);
      setError('');
      try {
        const avatarDataUrl = await loadPreset(preset);
        if (revision !== request.current) return;
        rememberPreset(preset.id);
        onChange?.({ avatarDataUrl });
        setSelected(preset.id);
      } catch (failure) {
        if (revision === request.current) setError(failure.message);
      } finally {
        if (revision === request.current) setPending('');
      }
    }

    async function upload(event) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const revision = ++request.current;
      setPending('custom');
      setError('');
      try {
        const avatarDataUrl = await readUpload(file);
        if (revision !== request.current) return;
        rememberPreset();
        onChange?.({ avatarDataUrl });
        setSelected('custom');
      } catch (failure) {
        if (revision === request.current) setError(failure.message);
      } finally {
        if (revision === request.current) setPending('');
      }
    }

    function generated() {
      ++request.current;
      rememberPreset();
      setPending('');
      setError('');
      onChange?.({ avatarDataUrl: undefined });
      setSelected('generated');
    }

    return jsx.jsxs('section', {
      className: 'carb-profile-picker',
      'aria-labelledby': galleryId,
      children: [
        jsx.jsxs('div', {
          className: 'carb-profile-picker__heading',
          children: [
            jsx.jsx('h2', { id: galleryId, children: text('Choose your avatar', '选择你的头像') }),
            jsx.jsx('span', { children: text('You can change it later in Settings.', '稍后也可以在设置中更换。') }),
          ],
        }),
        jsx.jsxs('div', {
          className: 'carb-profile-picker__actions',
          children: [
            jsx.jsxs('button', {
              type: 'button', className: 'carb-profile-picker__action',
              'aria-pressed': selected === 'generated', onClick: generated,
              children: [jsx.jsx('span', { className: 'carb-profile-picker__original', 'aria-hidden': true,
                children: jsx.jsx(GeneratedAvatar, { name: identity?.avatarSeed?.trim() || name }) }),
              text('Original avatar', '原有自定义头像')],
            }),
            jsx.jsxs('button', {
              type: 'button', className: 'carb-profile-picker__action',
              'aria-pressed': selected === 'custom', onClick: () => fileInput.current?.click(),
              children: [jsx.jsx('span', { className: 'carb-profile-picker__upload-icon', 'aria-hidden': true, children: '+' }),
                text('Upload an image', '上传自己的图片')],
            }),
            jsx.jsx('input', { ref: fileInput, type: 'file', accept: 'image/png,image/jpeg,image/webp',
              className: 'carb-profile-picker__file', tabIndex: -1,
              'aria-label': text('Upload an avatar', '上传头像'), onChange: upload }),
          ],
        }),
        jsx.jsx('div', {
          className: 'carb-profile-picker__grid', role: 'group',
          'aria-label': text('Preset avatars', '预设头像'),
          children: avatarPresets.map(preset => jsx.jsxs('button', {
            type: 'button', className: 'carb-profile-picker__choice',
            'aria-label': preset.name, 'aria-pressed': selected === preset.id,
            'aria-busy': pending === preset.id || undefined,
            title: preset.name, onClick: () => choose(preset),
            children: [
              jsx.jsx('img', { src: preset.source, alt: '', draggable: false, loading: 'lazy' }),
              jsx.jsx('span', { children: preset.name }),
            ],
          }, preset.id)),
        }),
        jsx.jsx('p', { className: `carb-profile-picker__status${error ? ' is-error' : ''}`,
          id: statusId, role: error ? 'alert' : 'status', 'aria-live': 'polite',
          children: error || (pending ? text('Loading avatar…', '正在加载头像…')
            : text('PNG, JPEG or WebP · under 1 MB', '支持 PNG、JPEG、WebP，图片小于 1 MB')) }),
      ],
    });
  };
}
