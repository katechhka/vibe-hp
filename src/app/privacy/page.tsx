import { LegalDocument } from '@/components/legal-document';
import { legalDocuments } from '@/data/legal';
export const metadata = {
  title: legalDocuments.privacy.title,
  description: legalDocuments.privacy.intro,
};
export default function Page() {
  return <LegalDocument document={legalDocuments.privacy} />;
}
