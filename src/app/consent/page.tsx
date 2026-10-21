import { LegalDocument } from '@/components/legal-document';
import { legalDocuments } from '@/data/legal';
export const metadata = {
  title: legalDocuments.consent.title,
  description: legalDocuments.consent.intro,
};
export default function Page() {
  return <LegalDocument document={legalDocuments.consent} />;
}
