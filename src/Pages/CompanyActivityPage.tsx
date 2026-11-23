import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import LanguageSwitcher from '../Components/LanguageSwitcher';
import BottomNavV0 from '../Components/BottomNavV0';
import CompanyActivityArticle from '../Components/CompanyActivityArticle';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';
import { COMPANY_BUCKET, activityTranslation, companyImageUrl, isCompanyRecord, type CompanyActivity } from '../content/companySchema';
import { companyActivityText } from '../content/companyActivityText';
import { supabase } from '../supabaseClient';
import './CompanyIntroduction.css';
import './CompanyActivityPage.css';

interface ArticleState { id: string; status: 'loading' | 'ready' | 'error'; activity?: CompanyActivity }
export default function CompanyActivityPage({ customer }: { customer: { customer_type: string } | null }) {
  const { activityId = '' } = useParams();
  const id = activityId.toLowerCase();
  const { language } = useLanguage();
  const { tokens, isDark } = useColorTokens();
  const text = companyActivityText[language];
  const [state, setState] = useState<ArticleState>({ id, status: 'loading' });
  const [retry, setRetry] = useState(0);
  const current: ArticleState = state.id === id ? state : { id, status: 'loading' };
  const title = current.activity ? activityTranslation(current.activity, language)?.title || text.untitled : text.title;
  const imageUrl = (path: string) => companyImageUrl(path, key => supabase.storage.from(COMPANY_BUCKET).getPublicUrl(key).data.publicUrl);

  useEffect(() => { window.scrollTo(0, 0); }, [id]);
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} | VIVIDAQUA`;
    return () => { document.title = previous; };
  }, [title]);
  useEffect(() => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) { setState({ id, status: 'ready' }); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); setState({ id, status: 'error' }); }, 15000);
    setState({ id, status: 'loading' });
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_company_page_content').abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error || !isCompanyRecord(data)) throw new Error('Content unavailable');
        setState({ id, status: 'ready', activity: data.document.activities?.find(activity => activity.id === id && activity.published) });
      } catch { if (!controller.signal.aborted) setState({ id, status: 'error' }); }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [id, retry]);

  const colors = {
    '--company-background': isDark ? tokens.pageBg : 'linear-gradient(155deg, #eaf7f9 0%, #c0e5e9 45%, #e2f4f6 100%)',
    '--company-text': tokens.text, '--company-muted': tokens.muted, '--company-card': tokens.card,
    '--company-border': tokens.primaryBorder, '--company-primary': tokens.primary, '--company-tint': tokens.primaryBg,
  } as CSSProperties;
  return <div className="company-page company-article-page" style={colors}>
    <header className="company-header"><Link to="/company#company-activities" className="company-back"><ArrowLeft size={17} aria-hidden="true" />{text.back}</Link><Link to="/company" className="company-brand" aria-label="VIVIDAQUA"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="VIVIDAQUA" width="144" height="33" /></Link><LanguageSwitcher /></header>
    <main className="company-article-main">
      {current.status === 'loading' ? <div className="company-article-message" role="status">{text.loading}</div> : current.status === 'error' ? <div className="company-article-message" role="alert"><p>{text.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></div> : current.activity ? <CompanyActivityArticle activity={current.activity} language={language} imageUrl={imageUrl} /> : <div className="company-article-message"><h1>{text.unavailable}</h1><p>{text.unavailableBody}</p><Link to="/company#company-activities">{text.back}</Link></div>}
      <footer className="company-footer"><span>© {new Date().getFullYear()} VIVIDAQUA</span><Link to="/company#company-activities"><ArrowLeft size={14} aria-hidden="true" />{text.back}</Link></footer>
    </main>
    {customer && <BottomNavV0 customer={customer} />}
  </div>;
}
