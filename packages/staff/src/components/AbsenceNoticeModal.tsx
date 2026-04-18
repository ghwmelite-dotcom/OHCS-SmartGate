import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { X, Thermometer, AlertTriangle, Car, HelpCircle, Check } from 'lucide-react';

type Reason = 'sick' | 'family_emergency' | 'transport' | 'other';

const REASONS: { value: Reason; label: string; Icon: typeof Thermometer }[] = [
  { value: 'sick', label: 'Sick', Icon: Thermometer },
  { value: 'family_emergency', label: 'Family emergency', Icon: AlertTriangle },
  { value: 'transport', label: 'Transport', Icon: Car },
  { value: 'other', label: 'Other', Icon: HelpCircle },
];

export function AbsenceNoticeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [expectedReturn, setExpectedReturn] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const today = new Date().toISOString().slice(0, 10);

  const mutation = useMutation({
    mutationFn: (body: { reason: Reason; note?: string; expected_return_date?: string }) =>
      api.post('/attendance/absence-notice', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-notice-today'] });
      setTimeout(() => onClose(), 2000);
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setErrorMsg('');
    const body: { reason: Reason; note?: string; expected_return_date?: string } = { reason };
    if (note.trim()) body.note = note.trim();
    if (expectedReturn) body.expected_return_date = expectedReturn;
    mutation.mutate(body);
  }

  const isSuccess = mutation.isSuccess;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6">
          {isSuccess ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check className="h-7 w-7 text-green-600" />
              </div>
              <p className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Notice sent</p>
              <p className="text-[14px] text-gray-500 mt-1">Your director has been notified.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Can't make it today
                </h3>
                <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Reason</label>
                  <div className="grid grid-cols-2 gap-2">
                    {REASONS.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setReason(value)}
                        className={`h-14 px-3 rounded-xl border-2 flex items-center gap-2 text-[14px] font-semibold transition-all ${
                          reason === value
                            ? 'border-[#1A4D2E] bg-[#1A4D2E]/5 text-[#1A4D2E]'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="text-left">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Note <span className="text-gray-400 normal-case">(optional)</span></label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                    maxLength={200}
                    rows={2}
                    placeholder="Any context you'd like your director to know."
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E] resize-none"
                  />
                  <p className="text-[11px] text-gray-400 mt-1 text-right">{note.length}/200</p>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Expected back <span className="text-gray-400 normal-case">(optional)</span></label>
                  <input
                    type="date"
                    min={today}
                    value={expectedReturn}
                    onChange={(e) => setExpectedReturn(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-gray-200 bg-gray-50 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E]"
                  />
                </div>

                {errorMsg && <p className="text-red-600 text-[13px] font-medium">{errorMsg}</p>}

                <button
                  type="submit"
                  disabled={!reason || mutation.isPending}
                  className="w-full h-12 bg-[#1A4D2E] text-white rounded-xl font-bold text-[15px] hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {mutation.isPending ? 'Sending...' : 'Send notice'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
