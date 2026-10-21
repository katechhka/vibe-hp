import { LegalDocument } from '@/components/legal-document';
import { legalDocuments } from '@/data/legal';
export const metadata = {
  title: legalDocuments.offer.title,
  description: legalDocuments.offer.intro,
};
export default function Page() {
  return <LegalDocument document={legalDocuments.offer} />;
}
