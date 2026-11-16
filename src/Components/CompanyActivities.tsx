import { activityTranslation, isActivityDate, type CompanyActivity, type CompanyLanguage } from '../content/companySchema';
import { companyActivityText } from '../content/companyActivityText';
import './CompanyActivities.css';

interface Props { activities?: CompanyActivity[]; language: CompanyLanguage; imageUrl: (path: string) => string; includeDrafts?: boolean }
export default function CompanyActivities({ activities = [], language, imageUrl, includeDrafts = false }: Props) {
  const text = companyActivityText[language];
  const items = activities.filter(activity => includeDrafts || activity.published);
  const locale = language === 'zh' ? 'zh-CN' : language === 'id' ? 'id-ID' : 'en-GB';
  return <section className="company-activities" id="company-activities" aria-labelledby="company-activities-title">
    <p className="company-section-label">{text.label}</p>
    <h2 id="company-activities-title">{text.title}</h2>
    {items.length === 0 ? <p className="company-activities-empty">{text.empty}</p> : <div className="company-activities-grid">
      {items.map(activity => {
        const copy = activityTranslation(activity, language) || { ...activity.translations[language], language };
        const title = copy.title.trim() || text.untitled;
        const photo = (image: string, index: number) => <a key={image} href={imageUrl(image)} target="_blank" rel="noopener noreferrer" aria-label={`${text.photo} ${index + 1}: ${title}`}><img src={imageUrl(image)} alt={`${title} ${index + 1}`} width="640" height="400" loading="lazy" /></a>;
        return <article className="company-activity-card" key={activity.id} data-activity-id={activity.id}>
          {activity.images[0] ? <div className="company-activity-cover">{photo(activity.images[0], 0)}</div> : <p className="company-activity-no-photo">{text.noPhoto}</p>}
          <div className="company-activity-copy"><div className="company-activity-meta"><time dateTime={activity.date}>{isActivityDate(activity.date) ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${activity.date}T00:00:00Z`)) : '—'}</time>{!activity.published && <span>{text.draft}</span>}</div>
            <div lang={copy.language === 'zh' ? 'zh-CN' : copy.language}><h3>{title}</h3><p>{copy.body}</p></div>
            {activity.images.length > 1 && <div className="company-activity-more">{activity.images.slice(1).map((image, index) => photo(image, index + 1))}</div>}
          </div>
        </article>;
      })}
    </div>}
  </section>;
}
