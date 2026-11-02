import {BACKGROUND_COPY} from '../copy.mjs';
export const BACKGROUND_FIELD='vc_mobile_background';

// Imported cards may contain arbitrary extension values. Only one local basename is a scene.
export function backgroundFile(value){return typeof value==='string'&&value.length>0&&value.length<=255&&!/[\/\\\u0000-\u001f\u007f]/.test(value)&&value!=='.'&&value!=='..'?value:'';}
// Absolute same-origin URLs keep uni-H5 from treating host images as /m/ build assets.
export function backgroundUrl(value,origin=globalThis.location?.origin||''){const file=backgroundFile(value);return file?`${origin}/backgrounds/${encodeURIComponent(file)}`:'';}
export function backgroundThumbnail(value,origin=globalThis.location?.origin||''){const file=backgroundFile(value);return file?`${origin}/thumbnail?type=bg&file=${encodeURIComponent(file)}`:'';}

export async function prepareBackgroundUpload(file,{decode=blob=>createImageBitmap(blob),id=()=>[...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(16).padStart(8,'0')).join('')}={}){
 const extension=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']]).get(file?.type);
 if(!extension||!file.size||file.size>32*1024*1024)throw Error(BACKGROUND_COPY.invalidImage);
 let bitmap;try{bitmap=await decode(file);}catch{throw Error(BACKGROUND_COPY.invalidImage);}finally{bitmap?.close?.();}
 return new File([file],`mobile-${id()}.${extension}`,{type:file.type});
}
