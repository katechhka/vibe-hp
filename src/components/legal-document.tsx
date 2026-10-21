import Link from 'next/link';
import { legalVersion, type LegalDocumentData } from '@/data/legal';
export function LegalDocument({ document }: { document: LegalDocumentData }) {
  return (
    <article className="container page-space legal-document">
      <header className="legal-heading">
        <Link className="text-link" href="/">
          ← В мастерскую
        </Link>
        <p className="eyebrow">Открыто и по делу · редакция {legalVersion}</p>
        <h1>{document.title}</h1>
        <p className="legal-intro">{document.intro}</p>
        <p className="legal-demo-note">
          Документ для демоверсии. Реальные покупки и доставка не выполняются.
          Для проверки используйте вымышленные данные.
        </p>
      </header>
      <div className="legal-layout">
        <nav className="legal-toc" aria-label="Содержание документа">
          <span className="eyebrow">На этой странице</span>
          {document.sections.map((section, i) => (
            <a key={section.title} href={'#section-' + (i + 1)}>
              {section.title}
            </a>
          ))}
        </nav>
        <div className="legal-body">
          {document.sections.map((section, i) => (
            <section id={'section-' + (i + 1)} key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
      <nav className="legal-related" aria-label="Другие документы">
        <Link href="/privacy">Политика обработки данных</Link>
        <Link href="/consent">Согласие на обработку</Link>
        <Link href="/offer">Оферта тестовой оплаты</Link>
        <Link href="/cookies">Cookie и данные браузера</Link>
      </nav>
    </article>
  );
}
