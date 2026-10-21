import { LegalDocument } from '@/components/legal-document';
import { legalDocuments } from '@/data/legal';
export const metadata = {
  title: legalDocuments.cookies.title,
  description: legalDocuments.cookies.intro,
};
export default function Page() {
  return <LegalDocument document={legalDocuments.cookies} />;
}
