// AGPL-3.0-only. SillyTavern 7e8663cd9 / utils.js, chats.js
// 浏览器资源读取/测量端口；不依赖原生页面或控件。
import { quietConsole } from './diagnostics.js';
export function createResourcePorts({getRequestHeaders,fetch=globalThis.fetch,toast,t}) {
const console=quietConsole,toastr=toast;
function calculateThumbnailSize(width, height, maxWidth, maxHeight) {
    // Calculate the thumbnail dimensions while maintaining the aspect ratio
    const aspectRatio = width / height;
    let thumbnailWidth = maxWidth;
    let thumbnailHeight = maxHeight;

    if (maxWidth === null) {
        thumbnailWidth = width;
        maxWidth = width;
    }

    if (maxHeight === null) {
        thumbnailHeight = height;
        maxHeight = height;
    }

    // Do not upscale if image is already smaller than max dimensions
    if (width <= maxWidth && height <= maxHeight) {
        thumbnailWidth = width;
        thumbnailHeight = height;
    } else {
        if (width > height) {
            thumbnailHeight = maxWidth / aspectRatio;
        } else {
            thumbnailWidth = maxHeight * aspectRatio;
        }
    }

    return { thumbnailWidth: Math.round(thumbnailWidth), thumbnailHeight: Math.round(thumbnailHeight) };
}
function getBase64Async(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = function () {
            resolve(String(reader.result));
        };
        reader.onerror = function (error) {
            reject(error);
        };
    });
}
function createThumbnail(dataUrl, maxWidth = null, maxHeight = null, type = 'image/jpeg') {
    // Someone might pass in a base64 encoded string without the data URL prefix
    if (!dataUrl.includes('data:')) {
        dataUrl = `data:image/jpeg;base64,${dataUrl}`;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = dataUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const { thumbnailWidth, thumbnailHeight } = calculateThumbnailSize(img.width, img.height, maxWidth, maxHeight);

            // Set the canvas dimensions and draw the resized image
            canvas.width = thumbnailWidth;
            canvas.height = thumbnailHeight;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, thumbnailWidth, thumbnailHeight);
            ctx.drawImage(img, 0, 0, thumbnailWidth, thumbnailHeight);

            // Convert the canvas to a data URL and resolve the promise
            const thumbnailDataUrl = canvas.toDataURL(type);
            resolve(thumbnailDataUrl);
        };

        img.onerror = () => {
            reject(new Error('Failed to load the image.'));
        };
    });
}
function getImageSizeFromDataURL(dataUrl) {
    const image = new Image();
    image.src = dataUrl;
    return new Promise((resolve, reject) => {
        image.onload = function () {
            resolve({ width: image.width, height: image.height });
        };
        image.onerror = function () {
            reject(new Error('Failed to load image'));
        };
    });
}
function getVideoDurationFromDataURL(dataUrl) {
    const video = document.createElement('video');
    video.src = dataUrl;
    return new Promise((resolve, reject) => {
        video.onloadedmetadata = function () {
            resolve(video.duration);
        };
        video.onerror = function () {
            reject(new Error('Failed to load video'));
        };
    });
}
function getAudioDurationFromDataURL(dataUrl) {
    const audio = document.createElement('audio');
    audio.src = dataUrl;
    return new Promise((resolve, reject) => {
        audio.onloadedmetadata = function () {
            resolve(audio.duration);
        };
        audio.onerror = function () {
            reject(new Error('Failed to load audio'));
        };
    });
}
function isDataURL(str) {
    const regex = /^data:([a-z]+\/[a-z0-9-+.]+(;[a-z-]+=[a-z0-9-]+)*;?)?(base64)?,([a-z0-9!$&',()*+;=\-_%.~:@/?#]+)?$/i;
    return typeof str === 'string' && regex.test(str);
}
async function getFileAttachment(url) {
    try {
        const result = await fetch(url, {
            method: 'GET',
            cache: 'force-cache',
            headers: getRequestHeaders(),
        });

        if (!result.ok) {
            const error = await result.text();
            throw new Error(error);
        }

        const text = await result.text();
        return text;
    } catch (error) {
        toastr.error(error, t`Could not download file`);
        console.error('Could not download file', error);
    }
}
async function appendFileContent(message, messageText) {
    if (!message || !message.extra || typeof message.extra !== 'object') {
        return messageText;
    }
    if (message.extra.fileLength >= 0) {
        delete message.extra.fileLength;
    }
    if (Array.isArray(message.extra?.files) && message.extra.files.length > 0) {
        const fileTexts = [];
        for (const file of message.extra.files) {
            const fileText = file.text || (await getFileAttachment(file.url));
            if (fileText) {
                fileTexts.push(fileText);
            }
        }
        const mergedFileTexts = fileTexts.join('\n\n') + '\n\n';
        message.extra.fileLength = mergedFileTexts.length;
        return mergedFileTexts + messageText;
    }
    return messageText;
}
return {calculateThumbnailSize,getBase64Async,createThumbnail,getImageSizeFromDataURL,getVideoDurationFromDataURL,getAudioDurationFromDataURL,isDataURL,appendFileContent};
}
