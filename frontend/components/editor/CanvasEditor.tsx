'use client';
import { GripVertical, MoreVertical, Sparkles, Send, Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function CanvasEditor() {
  const router = useRouter();
  return (
    <div className="h-dvh flex flex-col bg-white overflow-hidden font-sans">
      {/* Toolbar */}
      <header className="h-16 border-b border-slate-200 flex items-center justify-between px-6 bg-white shrink-0">
        <button
          onClick={() => router.push('/projects')}
          className="text-slate-500 font-bold text-sm hover:text-slate-900 transition-colors cursor-pointer"
        >
          ← My Projects
        </button>
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-900">2847 Sandburg Way</span>
          <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-md font-bold border border-slate-200">
            Draft •
          </span>
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 text-sm font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            Preview
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 bg-slate-50 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Block 1 */}
            <div className="bg-white rounded-2xl border-2 border-emerald-400 shadow-sm p-8 relative group">
              <div className="absolute top-4 left-2 cursor-grab opacity-50 hover:opacity-100 text-slate-400">
                <GripVertical className="w-5 h-5" />
              </div>
              <div className="absolute top-4 right-4 text-xs font-bold tracking-wider uppercase text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                Headline
              </div>
              <div className="pl-6 pt-2">
                <h1
                  className="text-3xl font-bold text-slate-900 outline-none leading-tight"
                  contentEditable
                  suppressContentEditableWarning
                >
                  Brand New Modern ADU in Woodbridge
                </h1>
              </div>
            </div>

            <button className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-sm font-bold hover:bg-slate-100 hover:text-slate-600 hover:border-slate-300 transition-all">
              + Add Section
            </button>

            {/* Block 2 */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 relative group hover:border-slate-300 transition-colors">
              <div className="absolute top-4 left-2 cursor-grab opacity-0 group-hover:opacity-50 hover:!opacity-100 text-slate-400">
                <GripVertical className="w-5 h-5" />
              </div>
              <div className="absolute top-4 right-4 text-xs font-bold tracking-wider uppercase text-slate-400">
                Description
              </div>
              <div className="pl-6 pt-2 mt-4">
                <p
                  className="text-slate-600 leading-relaxed outline-none font-medium text-lg"
                  contentEditable
                  suppressContentEditableWarning
                >
                  Be the first to live in this highly upgraded detached ADU. Featuring vaulted
                  ceilings, stainless steel appliances, and a private fenced yard perfect for
                  entertaining.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Agent Sidebar */}
        <div className="w-[400px] bg-white border-l border-slate-200 flex flex-col shrink-0 z-10 shadow-[-4px_0_24px_rgba(0,0,0,0.02)]">
          <div className="p-5 border-b border-slate-100 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-emerald-600" />
            </div>
            <h2 className="font-bold text-slate-900 tracking-tight">Listing Agent</h2>
          </div>

          <div className="p-3 border-b border-slate-50 flex gap-2 overflow-x-auto no-scrollbar">
            {['Investor-focused', 'SEO optimize', 'Suggest pricing'].map((chip) => (
              <button
                key={chip}
                className="whitespace-nowrap px-3 py-1.5 rounded-full bg-slate-50 text-slate-600 font-bold text-xs hover:bg-emerald-50 hover:text-emerald-700 transition-colors border border-slate-100 hover:border-emerald-200"
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl rounded-tl-sm p-4 text-sm text-slate-700 font-medium leading-relaxed">
                I&apos;ve generated a draft based on your property details. I noticed we&apos;re
                missing information about pets. Would you like me to add a pet policy section?
              </div>
            </div>

            <div className="flex gap-3 flex-row-reverse">
              <div className="bg-emerald-600 text-white rounded-2xl rounded-tr-sm p-4 text-sm shadow-sm font-medium leading-relaxed max-w-[85%]">
                Yes, make it pet friendly but under 30lbs only.
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0 shadow-sm">
                <Building2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center rounded-tl-sm p-4 py-5 text-sm text-slate-700 shadow-sm">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50">
            <div className="relative">
              <textarea
                className="w-full bg-white border border-slate-300 shadow-sm rounded-xl pr-12 pl-4 py-4 text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-shadow"
                rows={2}
                placeholder="Ask me to improve the description..."
              />
              <button className="absolute right-3 bottom-3 w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 transition-colors shadow-sm cursor-pointer">
                <Send className="w-4 h-4 -ml-0.5" />
              </button>
            </div>
            <div className="text-center mt-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                AI outputs can be inaccurate
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
