import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BrowserMockup, AnimatedCaption } from '../ui/Mockups';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 1000), // scroll start
      setTimeout(() => setPhase(3), 9000), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.8 }}
    >
      <div className="w-[85vw] h-[75vh] relative">
        <BrowserMockup className="w-full h-full bg-[#F7F5F0]">
          <div className="p-12 w-full h-full flex flex-col pt-24">
            
            <div className="flex gap-8">
              <div className="w-1/3 flex flex-col gap-4">
                {/* Active Tab indicator */}
                <div className="flex flex-col gap-2 mb-4">
                  <div className="text-[1.2vw] text-[#8E9B9F] font-medium">Defense</div>
                  <div className="text-[1.2vw] text-[#D66853] font-bold border-l-4 border-[#D66853] pl-2">Counter-attack</div>
                </div>
              </div>
              <div className="w-2/3 flex flex-col gap-6 relative">
                
                {/* Draft Document */}
                <motion.div 
                  className="bg-white rounded-xl shadow-lg border border-[#EBE7DF] p-8 flex flex-col gap-4 h-[50vh] overflow-hidden relative"
                  initial={{ opacity: 0, y: 20 }}
                  animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                  transition={{ duration: 0.6 }}
                >
                  <div className="absolute top-0 inset-x-0 h-12 bg-gradient-to-b from-white to-transparent z-10" />
                  <div className="absolute bottom-0 inset-x-0 h-12 bg-gradient-to-t from-white to-transparent z-10" />
                  
                  <motion.div 
                    className="flex flex-col gap-6"
                    animate={phase >= 2 ? { y: "-40%" } : { y: "0%" }}
                    transition={{ duration: 7, ease: "linear" }}
                  >
                    <div className="text-center font-display text-[1.5vw] font-bold mb-4">
                      RESPONSE TO NOTICE TO QUIT
                    </div>
                    
                    <div className="h-4 bg-[#EBE7DF] rounded w-1/3" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-1/4" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-1/2" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-full mt-4" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-full" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-5/6" />
                    
                    <div className="h-4 bg-[#D66853]/20 rounded w-full mt-4" />
                    <div className="h-4 bg-[#D66853]/20 rounded w-full" />
                    <div className="h-4 bg-[#D66853]/20 rounded w-4/6" />
                    
                    <div className="h-4 bg-[#EBE7DF] rounded w-full mt-4" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-full" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-5/6" />
                    
                    <div className="h-4 bg-[#EBE7DF] rounded w-full mt-4" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-full" />
                    <div className="h-4 bg-[#EBE7DF] rounded w-3/4" />
                  </motion.div>
                </motion.div>

              </div>
            </div>
          </div>
        </BrowserMockup>
      </div>

      <AnimatedCaption text="Then it drafts your response and shows you what to file back." phase={phase >= 1 ? 1 : 0} />
    </motion.div>
  );
}
