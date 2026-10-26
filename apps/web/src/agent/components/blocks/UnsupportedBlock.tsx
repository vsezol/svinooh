export default function UnsupportedBlock({ kind }: { kind: string }) {
  return <div className="sv-a-b-unsupported">[unsupported: {kind}]</div>;
}
