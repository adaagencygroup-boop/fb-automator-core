"use client";

import React from "react";
import { ThumbsUp, MessageCircle, Share2, Info, Check } from "lucide-react";

interface PostReactionSelectorProps {
  doLike: boolean;
  onDoLikeChange: (val: boolean) => void;
  doComment: boolean;
  onDoCommentChange: (val: boolean) => void;
  doShare: boolean;
  onDoShareChange: (val: boolean) => void;
  selectedReactions: string[];
  onToggleReaction: (reaction: string) => void;
}

// ─────────────────────────────────────────────────────────────
// 7 REACTION ICONS CHUẨN FACEBOOK (SVG)
// ─────────────────────────────────────────────────────────────
function FbLikeIcon({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#filter0_d_1778_3553)">
        <rect x="2" y="1" width="32" height="32" rx="16" fill="#1877F2" shapeRendering="crispEdges" />
        <path d="M19.3359 14.9987V12.332C19.3359 11.2282 18.4398 10.332 17.3359 10.332L14.6693 16.332V23.6654H22.1893C22.8541 23.6729 23.4229 23.1894 23.5226 22.532L24.4426 16.532C24.5013 16.1453 24.3872 15.7522 24.1305 15.457C23.8738 15.1618 23.5004 14.9943 23.1093 14.9987H19.3359ZM14.6693 23.6654H12.6693C11.9334 23.6654 11.3359 23.0679 11.3359 22.332V17.6654C11.3359 16.9295 11.9334 16.332 12.6693 16.332H14.6693V23.6654Z" fill="white" />
      </g>
      <defs>
        <filter id="filter0_d_1778_3553" x="0" y="0" width="36" height="36" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1778_3553" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1778_3553" result="shape" />
        </filter>
      </defs>
    </svg>
  );
}

function FbLoveIcon({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#filter0_d_1778_3564)">
        <rect x="2" y="1" width="32" height="32" rx="16" fill="url(#paint0_linear_1778_3564)" shapeRendering="crispEdges" />
        <path d="M18.0026 23.2333L17.0359 22.3533C13.6026 19.24 11.3359 17.1867 11.3359 14.6667C11.3359 12.6133 12.9493 11 15.0026 11C16.1626 11 17.2759 11.54 18.0026 12.3933C18.7293 11.54 19.8426 11 21.0026 11C23.0559 11 24.6693 12.6133 24.6693 14.6667C24.6693 17.1867 22.4026 19.24 18.9693 22.36L18.0026 23.2333Z" fill="white" />
      </g>
      <defs>
        <filter id="filter0_d_1778_3564" x="0" y="0" width="36" height="36" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1778_3564" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1778_3564" result="shape" />
        </filter>
        <linearGradient id="paint0_linear_1778_3564" x1="2" y1="33" x2="34" y2="1" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E41E3F" />
          <stop offset="1" stopColor="#FA3E3E" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function FbCareIcon({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#filter0_d_1778_3574)">
        <g clipPath="url(#clip0_1778_3574)">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" fillOpacity="0.01" shapeRendering="crispEdges" />
          <path d="M2.89062 17.0017C2.89063 25.3418 9.66169 32.1128 18.0017 32.1128C26.3418 32.1128 33.1128 25.3418 33.1128 17.0017C33.1128 8.66169 26.3418 1.89062 18.0017 1.89062C9.66169 1.89062 2.89063 8.66169 2.89062 17.0017Z" fill="#FBD872" />
          <path d="M10.4453 12.1107C10.4453 11.3996 10.9786 10.7773 11.7786 10.7773C13.0231 10.7773 14.0009 11.7551 14.0009 12.9996C14.0009 13.2662 13.8231 13.444 13.5564 13.444C13.2898 13.444 13.112 13.2662 13.112 12.9996C13.112 12.2885 12.4898 11.6662 11.7786 11.6662C11.512 11.6662 11.3342 11.4885 11.3342 11.2218L10.4453 12.1107ZM22.4453 12.1107C22.4453 11.3996 22.9786 10.7773 23.7786 10.7773C25.0231 10.7773 26.0009 11.7551 26.0009 12.9996C26.0009 13.2662 25.8231 13.444 25.5564 13.444C25.2898 13.444 25.112 13.2662 25.112 12.9996C25.112 12.2885 24.4898 11.6662 23.7786 11.6662C23.512 11.6662 23.3342 11.4885 23.3342 11.2218L22.4453 12.1107Z" fill="#B7791F" />
          <path d="M16.3984 17.8882C16.3984 19.0166 17.1154 19.9326 17.9984 19.9326C18.8815 19.9326 19.5984 19.0166 19.5984 17.8882C19.5984 16.7598 18.8815 15.8438 17.9984 15.8438C17.1154 15.8438 16.3984 16.7598 16.3984 17.8882Z" fill="#664500" />
          <path d="M17.9993 18.3339C16.3993 16.0228 13.1104 16.3783 12.2215 18.8672C11.3327 21.3561 13.466 24.1116 17.9993 27.045C22.5327 24.1116 24.666 21.3561 23.7771 18.8672C22.8882 16.3783 19.5993 16.0228 17.9993 18.3339Z" fill="#E0245E" />
          <path d="M11.7812 23.6677C12.2257 22.3344 14.0035 21.89 15.159 22.7789C15.5146 23.0455 15.4257 23.5789 14.9813 23.5789C14.0924 23.5789 13.3813 23.9344 13.1146 24.6455C12.9368 25.09 12.3146 25.0011 11.7812 23.6677V23.6677ZM24.2257 23.6677C23.7812 22.3344 22.0035 21.89 20.8479 22.7789C20.4924 23.0455 20.5813 23.5789 21.0257 23.5789C21.9146 23.5789 22.6257 23.9344 22.8924 24.6455C23.0701 25.09 23.6924 25.0011 24.2257 23.6677Z" fill="#FBD872" />
          <path d="M11.7812 23.6677C12.2257 22.3344 14.0035 21.89 15.159 22.7789C15.5146 23.0455 15.4257 23.5789 14.9813 23.5789C14.0924 23.5789 13.3813 23.9344 13.1146 24.6455C12.9368 25.09 12.3146 25.0011 11.7812 23.6677V23.6677M24.2257 23.6677C23.7813 22.3344 22.0035 21.89 20.8479 22.7789C20.4924 23.0455 20.5813 23.5789 21.0257 23.5789C21.9146 23.5789 22.6257 23.9344 22.8924 24.6455C23.0701 25.09 23.6924 25.0011 24.2257 23.6677V23.6677" stroke="#D39E36" strokeWidth="0.533333" />
        </g>
      </g>
      <defs>
        <filter id="filter0_d_1778_3574" x="0" y="0" width="36" height="36" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1778_3574" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1778_3574" result="shape" />
        </filter>
        <clipPath id="clip0_1778_3574">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

function FbHahaIcon({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#filter0_d_1778_3586)">
        <g clipPath="url(#clip0_1778_3586)">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" fillOpacity="0.01" shapeRendering="crispEdges" />
          <g clipPath="url(#clip1_1778_3586)">
            <path d="M2.89062 17.0017C2.89063 25.3418 9.66169 32.1128 18.0017 32.1128C26.3418 32.1128 33.1128 25.3418 33.1128 17.0017C33.1128 8.66169 26.3418 1.89062 18.0017 1.89062C9.66169 1.89062 2.89063 8.66169 2.89062 17.0017Z" fill="#FBD872" />
            <path d="M9.10748 12.3776C10.7075 13.5331 12.3075 13.5331 13.9075 12.3776C14.263 12.1109 14.7075 12.2887 14.7964 12.6443C14.9741 12.9998 14.7964 13.4443 14.5297 13.5331C12.3964 15.0443 10.263 15.0443 8.1297 13.5331C7.77415 13.2665 7.68526 12.822 7.95193 12.4665C8.21859 12.1109 8.66304 12.1109 9.10748 12.3776ZM22.0853 12.3776C23.6853 13.5331 25.2853 13.5331 26.8853 12.3776C27.2408 12.1109 27.6853 12.2887 27.7741 12.6443C27.9519 12.9998 27.7741 13.4443 27.5075 13.5331C25.3741 15.0443 23.2408 15.0443 21.1075 13.5331C20.7519 13.2665 20.663 12.822 20.9297 12.4665C21.1964 12.1109 21.6408 12.1109 22.0853 12.3776Z" fill="#664500" />
            <path d="M9.55469 18.3342C9.55469 17.8009 9.91024 17.4453 10.4436 17.4453H25.5547C26.088 17.4453 26.4436 17.8009 26.4436 18.3342C26.4436 22.7786 22.6214 26.7786 17.9991 26.7786C13.3769 26.7786 9.55469 22.7786 9.55469 18.3342H9.55469Z" fill="#664500" />
            <path d="M11.6016 20.1094C12.846 23.3094 15.3349 24.9983 18.0016 24.9983C20.6682 24.9983 23.1571 23.3094 24.4016 20.1094C22.3571 20.8205 20.2238 21.176 18.0016 21.176C15.7793 21.176 13.646 20.8205 11.6016 20.1094Z" fill="#DA2F47" />
            <path d="M10.4453 17.4453H25.5564C25.5564 18.512 25.2009 19.4009 24.6675 19.9342H11.3342C10.8009 19.4009 10.4453 18.512 10.4453 17.4453Z" fill="white" />
          </g>
        </g>
      </g>
      <defs>
        <filter id="filter0_d_1778_3586" x="0" y="0" width="36" height="36" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1778_3586" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1778_3586" result="shape" />
        </filter>
        <clipPath id="clip0_1778_3586">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" />
        </clipPath>
        <clipPath id="clip1_1778_3586">
          <rect width="32" height="32" fill="white" transform="translate(2 1)" />
        </clipPath>
      </defs>
    </svg>
  );
}

function FbWowIcon({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#filter0_d_1778_3601)">
        <g clipPath="url(#clip0_1778_3601)">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" fillOpacity="0.01" shapeRendering="crispEdges" />
          <path d="M2.89062 17.0017C2.89063 25.3418 9.66169 32.1128 18.0017 32.1128C26.3418 32.1128 33.1128 25.3418 33.1128 17.0017C33.1128 8.66169 26.3418 1.89062 18.0017 1.89062C9.66169 1.89062 2.89063 8.66169 2.89062 17.0017Z" fill="#FBD872" />
          <path d="M9.1128 10.3314C9.82391 8.99811 11.335 8.37589 12.935 8.73145C13.3795 8.82034 13.6461 9.26478 13.4684 9.70923C13.3795 10.1537 12.935 10.4203 12.4906 10.2426C11.5128 9.97589 10.6239 10.4203 10.0906 11.3092C9.9128 11.6648 9.46835 11.8426 9.1128 11.6648C8.75724 11.3981 8.57947 10.9537 8.75724 10.5092L9.1128 10.3314ZM23.0684 9.70923C24.6684 9.35367 26.1795 9.97589 26.8906 11.3092C27.0684 11.6648 26.9795 12.1092 26.535 12.287C26.1795 12.4648 25.735 12.3759 25.5572 11.9314C25.1128 11.0426 24.135 10.5981 23.1572 10.8648C22.7128 10.9537 22.2684 10.687 22.1795 10.3314C22.0017 9.79811 22.2684 9.35367 22.7128 9.35367L23.0684 9.70923Z" fill="#664500" />
          <path d="M10.625 15.2234C10.625 16.7932 11.5411 18.0678 12.6694 18.0678C13.7978 18.0678 14.7139 16.7932 14.7139 15.2234C14.7139 13.6535 13.7978 12.3789 12.6694 12.3789C11.5411 12.3789 10.625 13.6535 10.625 15.2234Z" fill="#664500" />
          <path d="M21.2891 15.2234C21.2891 16.7932 22.2051 18.0678 23.3335 18.0678C24.4619 18.0678 25.378 16.7932 25.378 15.2234C25.378 13.6535 24.4619 12.3789 23.3335 12.3789C22.2051 12.3789 21.2891 13.6535 21.2891 15.2234Z" fill="#664500" />
          <path d="M14.625 22.7795C14.625 25.4778 16.1385 27.6684 18.0028 27.6684C19.867 27.6684 21.3806 25.4778 21.3806 22.7795C21.3806 20.0813 19.867 17.8906 18.0028 17.8906C16.1385 17.8906 14.625 20.0813 14.625 22.7795V22.7795Z" fill="#664500" />
          <path d="M15.5078 22.7793C15.5078 24.8888 16.623 26.6015 17.9967 26.6015C19.3704 26.6015 20.4856 24.8888 20.4856 22.7793C20.4856 20.6697 19.3704 18.957 17.9967 18.957C16.623 18.957 15.5078 20.6697 15.5078 22.7793Z" fill="#331B00" />
        </g>
      </g>
      <defs>
        <filter id="filter0_d_1778_3601" x="0" y="0" width="36" height="36" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1778_3601" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1778_3601" result="shape" />
        </filter>
        <clipPath id="clip0_1778_3601">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

function FbSadIcon({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#filter0_d_1778_3616)">
        <g clipPath="url(#clip0_1778_3616)">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" fillOpacity="0.01" shapeRendering="crispEdges" />
          <path d="M2.89062 17.0017C2.89063 25.3418 9.66169 32.1128 18.0017 32.1128C26.3418 32.1128 33.1128 25.3418 33.1128 17.0017C33.1128 8.66169 26.3418 1.89062 18.0017 1.89062C9.66169 1.89062 2.89063 8.66169 2.89062 17.0017Z" fill="#FBD872" />
          <path d="M9.29167 11.6681C10.3583 10.957 11.7806 10.8681 12.9361 11.4015C13.3806 11.5792 13.5583 12.0237 13.3806 12.4681C13.2028 12.9126 12.7583 13.0903 12.3139 12.9126C11.6917 12.6459 10.8028 12.6459 10.1806 13.0903C9.825 13.357 9.29167 13.2681 9.025 12.9126C8.75833 12.4681 8.84722 12.0237 9.29167 11.6681ZM23.0694 12.4681C24.225 11.9348 25.6472 12.0237 26.7139 12.7348C27.0694 13.0015 27.1583 13.5348 26.8917 13.8903C26.625 14.2459 26.0917 14.3348 25.7361 14.0681C25.1139 13.6237 24.225 13.6237 23.6028 13.8903C23.1583 14.0681 22.7139 13.8903 22.5361 13.4459C22.4472 13.0903 22.625 12.6459 23.0694 12.4681Z" fill="#664500" />
          <path d="M11.0703 16.11C11.0703 17.4836 11.9864 18.5989 13.1148 18.5989C14.2431 18.5989 15.1592 17.4836 15.1592 16.11C15.1592 14.7363 14.2431 13.6211 13.1148 13.6211C11.9864 13.6211 11.0703 14.7363 11.0703 16.11Z" fill="#664500" />
          <path d="M20.8438 16.11C20.8438 17.4836 21.7598 18.5989 22.8882 18.5989C24.0166 18.5989 24.9326 17.4836 24.9326 16.11C24.9326 14.7363 24.0166 13.6211 22.8882 13.6211C21.7598 13.6211 20.8438 14.7363 20.8438 16.11Z" fill="#664500" />
          <path d="M14.4469 24.5573C14.7136 22.9573 16.2247 21.8906 18.0025 21.8906C19.7802 21.8906 21.2914 22.9573 21.558 24.5573C21.6469 24.9128 21.3802 25.2684 21.0247 25.3573C20.6691 25.4462 20.3136 25.1795 20.2247 24.824C20.0469 23.8462 19.0691 23.224 18.0025 23.224C16.9358 23.224 15.958 23.8462 15.7802 24.824C15.6914 25.1795 15.3358 25.4462 14.9802 25.3573C14.6247 25.2684 14.358 24.9128 14.4469 24.5573Z" fill="#664500" />
          <path d="M9.10938 17.4453C9.10938 16.112 10.7094 13.4453 10.7094 13.4453C10.7094 13.4453 12.3094 16.112 12.3094 17.4453C12.3094 18.3342 11.5983 19.0453 10.7094 19.0453C9.82049 19.0453 9.10938 18.3342 9.10938 17.4453Z" fill="#55ACEE" />
        </g>
      </g>
      <defs>
        <filter id="filter0_d_1778_3616" x="0" y="0" width="36" height="36" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1778_3616" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1778_3616" result="shape" />
        </filter>
        <clipPath id="clip0_1778_3616">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

function FbAngryIcon({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#filter0_d_1778_3628)">
        <g clipPath="url(#clip0_1778_3628)">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" fillOpacity="0.01" shapeRendering="crispEdges" />
          <path d="M2.89062 17.0017C2.89063 25.3418 9.66169 32.1128 18.0017 32.1128C26.3418 32.1128 33.1128 25.3418 33.1128 17.0017C33.1128 8.66169 26.3418 1.89062 18.0017 1.89062C9.66169 1.89062 2.89063 8.66169 2.89062 17.0017Z" fill="url(#paint0_linear_1778_3628)" />
          <path d="M9.11193 12.1127L15.3342 15.2238C15.6897 15.4016 15.8675 15.846 15.6897 16.2016C15.5119 16.5572 15.0675 16.7349 14.7119 16.5572L8.66749 13.446C8.31193 13.2683 8.13415 12.8238 8.31193 12.4683C8.40082 12.1127 8.75638 11.9349 9.11193 12.1127ZM20.6675 15.2238L26.8897 12.1127C27.2453 11.9349 27.6897 12.1127 27.8675 12.4683C28.0453 12.8238 27.8675 13.2683 27.5119 13.446L21.5564 16.5572C21.2008 16.7349 20.7564 16.5572 20.5786 16.2016C20.4008 15.846 20.5786 15.4016 20.9342 15.2238H20.6675Z" fill="#421A00" />
          <path d="M11.1562 18.3316C11.1562 19.5581 12.0325 20.5538 13.1118 20.5538C14.1911 20.5538 15.0674 19.5581 15.0674 18.3316C15.0674 17.1051 14.1911 16.1094 13.1118 16.1094C12.0325 16.1094 11.1562 17.1051 11.1562 18.3316Z" fill="#421A00" />
          <path d="M20.9297 18.3316C20.9297 19.5581 21.8059 20.5538 22.8852 20.5538C23.9645 20.5538 24.8408 19.5581 24.8408 18.3316C24.8408 17.1051 23.9645 16.1094 22.8852 16.1094C21.8059 16.1094 20.9297 17.1051 20.9297 18.3316Z" fill="#421A00" />
          <path d="M13.5535 24.5562C14.6202 23.2228 16.2202 22.5117 17.9979 22.5117C19.7757 22.5117 21.3757 23.2228 22.4424 24.5562C22.709 24.9117 22.6202 25.3562 22.2646 25.6228C21.909 25.8895 21.4646 25.8006 21.1979 25.4451C20.3979 24.4673 19.2424 23.9339 17.9979 23.9339C16.7535 23.9339 15.5979 24.4673 14.7979 25.4451C14.5313 25.8006 14.0868 25.8895 13.7313 25.6228C13.3757 25.3562 13.2868 24.9117 13.5535 24.5562Z" fill="#421A00" />
        </g>
      </g>
      <defs>
        <filter id="filter0_d_1778_3628" x="0" y="0" width="36" height="36" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1778_3628" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1778_3628" result="shape" />
        </filter>
        <linearGradient id="paint0_linear_1778_3628" x1="2.89062" y1="1.89062" x2="2.89062" y2="32.1128" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E93F33" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
        <clipPath id="clip0_1778_3628">
          <rect x="2" y="1" width="32" height="32" rx="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

const REACTIONS = [
  { id: "LIKE", label: "Thích", Icon: FbLikeIcon },
  { id: "LOVE", label: "Yêu thích", Icon: FbLoveIcon },
  { id: "CARE", label: "Thương thương", Icon: FbCareIcon },
  { id: "HAHA", label: "Haha", Icon: FbHahaIcon },
  { id: "WOW", label: "Wow", Icon: FbWowIcon },
  { id: "SAD", label: "Buồn", Icon: FbSadIcon },
  { id: "ANGRY", label: "Phẫn nộ", Icon: FbAngryIcon },
];

export default function PostReactionSelector({
  doLike,
  onDoLikeChange,
  doComment,
  onDoCommentChange,
  doShare,
  onDoShareChange,
  selectedReactions,
  onToggleReaction,
}: PostReactionSelectorProps) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 space-y-5">
      {/* Step Header */}
      <div className="flex items-center gap-3">
        <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
          2
        </span>
        <h2 className="text-base font-bold text-gray-900">
          Chọn loại tương tác & Cảm xúc
        </h2>
      </div>

      {/* 3 Interaction Mode Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {/* Like */}
        <label
          className={`relative flex items-center gap-3.5 p-4 rounded-xl border cursor-pointer transition-all ${
            doLike
              ? "border-blue-500 bg-blue-50/50 shadow-sm shadow-blue-500/10"
              : "border-gray-200 hover:border-gray-300 bg-gray-50/30"
          }`}
        >
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
            <ThumbsUp className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-bold text-gray-900">Like bài viết</h4>
            <p className="text-[11px] text-gray-500">Tương tác bài viết này</p>
          </div>
          <input
            type="checkbox"
            checked={doLike}
            onChange={(e) => onDoLikeChange(e.target.checked)}
            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </label>

        {/* Comment */}
        <label
          className={`relative flex items-center gap-3.5 p-4 rounded-xl border cursor-pointer transition-all ${
            doComment
              ? "border-blue-500 bg-blue-50/50 shadow-sm shadow-blue-500/10"
              : "border-gray-200 hover:border-gray-300 bg-gray-50/30"
          }`}
        >
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
            <MessageCircle className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-bold text-gray-900">Bình luận</h4>
            <p className="text-[11px] text-gray-500">Tự động bình luận bài viết</p>
          </div>
          <input
            type="checkbox"
            checked={doComment}
            onChange={(e) => onDoCommentChange(e.target.checked)}
            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </label>

        {/* Share */}
        <label
          className={`relative flex items-center gap-3.5 p-4 rounded-xl border cursor-pointer transition-all ${
            doShare
              ? "border-blue-500 bg-blue-50/50 shadow-sm shadow-blue-500/10"
              : "border-gray-200 hover:border-gray-300 bg-gray-50/30"
          }`}
        >
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
            <Share2 className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-bold text-gray-900">Chia sẻ</h4>
            <p className="text-[11px] text-gray-500">Chia sẻ về trang cá nhân</p>
          </div>
          <input
            type="checkbox"
            checked={doShare}
            onChange={(e) => onDoShareChange(e.target.checked)}
            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </label>
      </div>

      {/* Facebook Reactions Picker */}
      {doLike && (
        <div className="space-y-2.5 pt-2 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-800">
              Cảm xúc Facebook (Reactions)
            </label>
            <span className="text-[11px] text-blue-600 font-semibold">
              Đã chọn {selectedReactions.length} cảm xúc
            </span>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2.5">
            {REACTIONS.map((r) => {
              const isSelected = selectedReactions.includes(r.id);
              const IconComp = r.Icon;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onToggleReaction(r.id)}
                  className={`relative flex flex-col items-center justify-center py-3.5 px-2 rounded-2xl border transition-all ${
                    isSelected
                      ? "border-blue-500 bg-blue-50/40 shadow-sm ring-2 ring-blue-500/20"
                      : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50"
                  }`}
                >
                  {isSelected && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </span>
                  )}
                  <div className="mb-2 transition-transform duration-150 hover:scale-110">
                    <IconComp className="w-9 h-9" />
                  </div>
                  <span className="text-[11px] font-semibold text-gray-700 text-center select-none">
                    {r.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-50/60 text-blue-800 text-[11px] mt-2">
            <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>
              <strong>Chọn nhiều cảm xúc:</strong> Hệ thống sẽ tự động random phân bổ đều các reaction này cho các lượt tương tác của tài khoản.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
