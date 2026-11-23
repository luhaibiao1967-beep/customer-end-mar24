import { useState, type ReactNode, type MouseEvent } from 'react';
import { activityTranslation, isActivityDate, type CompanyActivity, type CompanyLanguage } from '../content/companySchema';
import { companyActivityText } from '../content/companyActivityText';
import CompanyActivityArticle from './CompanyActivityArticle';
import './CompanyActivities.css';

interface Props { activities?: CompanyActivity[]; language: CompanyLanguage; imageUrl: (path: string) => string; includeDrafts?: boolean; activityHref?: (id: string) => string; onOpenActivity?: (id: string) => void }
export default function CompanyActivities({ activities = [], language, imageUrl, includeDrafts = false, activityHref, onOpenActivity }: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const text = companyActivityText[language];
  const items = activities.filter(activity => includeDrafts || activity.published);
  const locale = language === 'zh' ? 'zh-CN' : language === 'id' ? 'id-ID' : 'en-GB';
  const preview = !activityHref && items.find(item => item.id === previewId);
  if (preview) return <div className="company-activity-preview"><button type="button" onClick={() => setPreviewId(null)}>← {text.back}</button><CompanyActivityArticle activity={preview} language={language} imageUrl={imageUrl} /></div>;
  return <section className="company-activities" id="company-activities" aria-labelledby="company-activities-title">
    <p className="company-section-label">{text.label}</p>
    <h2 id="company-activities-title">{text.title}</h2>
    {items.length === 0 ? <p className="company-activities-empty">{text.empty}</p> : <div className="company-activities-grid">
      {items.map(activity => {
        const copy = activityTranslation(activity, language) || { ...activity.translations[language], language };
        const title = copy.title.trim() || text.untitled;
        const open = (event: MouseEvent<HTMLAnchorElement>) => { if (onOpenActivity && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenActivity(activity.id); } };
        const action = (children: ReactNode, className: string, label?: string) => activityHref ? <a href={activityHref(activity.id)} className={className} aria-label={label} onClick={open}>{children}</a> : <button type="button" className={className} aria-label={label} onClick={() => setPreviewId(activity.id)}>{children}</button>;
        const body = Array.from(copy.body.trim());
        const summary = body.length > 180 ? body.slice(0, 180).join('') + '…' : copy.body;
        return <article className="company-activity-card" key={activity.id} data-activity-id={activity.id}>
          {activity.images[0] ? <div className="company-activity-cover">{action(<img src={imageUrl(activity.images[0])} alt={title} width="640" height="400" loading="lazy" />, 'company-activity-open-cover', `${text.read}: ${title}`)}</div> : <p className="company-activity-no-photo">{text.noPhoto}</p>}
          <div className="company-activity-copy"><div className="company-activity-meta"><time dateTime={activity.date}>{isActivityDate(activity.date) ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${activity.date}T00:00:00Z`)) : '—'}</time>{!activity.published && <span>{text.draft}</span>}</div>
            <div lang={copy.language === 'zh' ? 'zh-CN' : copy.language}><h3>{action(title, 'company-activity-title-link')}</h3><p>{summary}</p></div>
            {action(<>{text.read}<span aria-hidden="true"> →</span></>, 'company-activity-read-more')}
          </div>
        </article>;
      })}
    </div>}
  </section>;
}
