import { useState } from 'react';
import { activityTranslation, isActivityDate, type CompanyActivity, type CompanyLanguage } from '../content/companySchema';
import { companyActivityText } from '../content/companyActivityText';
import './CompanyActivityArticle.css';

function ArticlePhoto({ src, alt, unavailable, first }: { src: string; alt: string; unavailable: string; first: boolean }) {
  const [failed, setFailed] = useState(false);
  return <figure className="company-article-photo">{failed ? <div className="company-article-photo-fallback" role="img" aria-label={alt}>{unavailable}</div> : <img src={src} alt={alt} loading={first ? 'eager' : 'lazy'} onError={() => setFailed(true)} />}</figure>;
}

export default function CompanyActivityArticle({ activity, language, imageUrl }: { activity: CompanyActivity; language: CompanyLanguage; imageUrl: (path: string) => string }) {
  const text = companyActivityText[language];
  const copy = activityTranslation(activity, language) || { ...activity.translations[language], language };
  const title = copy.title.trim() || text.untitled;
  const locale = language === 'zh' ? 'zh-CN' : language === 'id' ? 'id-ID' : 'en-GB';
  const photo = (image: string, index: number) => <ArticlePhoto key={image} src={imageUrl(image)} alt={`${title} — ${text.photoLabel} ${index + 1}`} unavailable={text.imageUnavailable} first={index === 0} />;
  return <article className="company-activity-article" data-activity-id={activity.id}>
    <header className="company-article-heading"><p className="company-section-label">{text.label}</p><h1 className="company-article-title" lang={copy.language === 'zh' ? 'zh-CN' : copy.language}>{title}</h1><div className="company-activity-meta"><span>VIVIDAQUA</span><time dateTime={activity.date}>{isActivityDate(activity.date) ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${activity.date}T00:00:00Z`)) : '—'}</time>{!activity.published && <span>{text.draft}</span>}</div></header>
    {activity.images[0] && photo(activity.images[0], 0)}
    <div className="company-article-body" lang={copy.language === 'zh' ? 'zh-CN' : copy.language}>{copy.body.split(/\r?\n\s*\r?\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    {activity.images.slice(1).map((image, index) => photo(image, index + 1))}
  </article>;
}
