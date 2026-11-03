import { useLojas } from '../hooks/useLojas';

export default function LojaLabel({ codiloja, showCode = true, className = '' }) {
  const { getLojaName } = useLojas();

  if (!codiloja) return <span className={className}>-</span>;

  return (
    <span className={className}>
      {showCode && <span className="font-mono text-gray-500">{codiloja}</span>}
      <span className={showCode ? 'ml-2' : ''}>{getLojaName(codiloja)}</span>
    </span>
  );
}
