import { useLojas } from '../hooks/useLojas';

export default function LojaSelect({
  value,
  onChange,
  className = 'input-field',
  allLabel = 'Todas as lojas',
  emptyLabel = null,
  includeAll = true,
  ...props
}) {
  const { lojas } = useLojas();

  return (
    <select value={value || ''} onChange={onChange} className={className} {...props}>
      {includeAll && <option value="">{allLabel}</option>}
      {!includeAll && emptyLabel !== null && <option value="">{emptyLabel}</option>}
      {lojas.map((loja) => (
        <option key={loja.codiloja} value={loja.codiloja}>
          {loja.nomeloja}
        </option>
      ))}
    </select>
  );
}
