import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BrowserMockup, AnimatedCaption } from '../ui/Mockups';
import uploadImg from '@assets/screenshots/02-upload.jpg';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 1000), // defense badge
      setTimeout(() => setPhase(3), 3000), // chips appear
      setTimeout(() => setPhase(4), 13000), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="w-[85vw] h-[75vh] relative">
        <BrowserMockup className="w-full h-full bg-[#F7F5F0]">
          <div className="p-12 w-full h-full flex flex-col pt-24">
            <motion.div 
              className="w-[60%] h-12 bg-[#EBE7DF] rounded-md mb-8"
              initial={{ width: 0 }}
              animate={{ width: "60%" }}
              transition={{ duration: 1 }}
            />
            <div className="flex gap-8">
              <div className="w-1/3 flex flex-col gap-4">
                <motion.div className="w-full h-[60vh] bg-white rounded-lg shadow-sm border border-[#EBE7DF] p-6 relative overflow-hidden">
                  <motion.img 
                    src={uploadImg} 
                    className="absolute inset-0 w-full h-full object-cover opacity-30 blur-sm"
                  />
                  <div className="relative z-10 space-y-4">
                    <div className="w-full h-4 bg-[#EBE7DF] rounded" />
                    <div className="w-5/6 h-4 bg-[#EBE7DF] rounded" />
                    <div className="w-4/6 h-4 bg-[#EBE7DF] rounded" />
                  </div>
                </motion.div>
              </div>
              <div className="w-2/3 flex flex-col gap-6 relative">
                
                {/* Defense Badge */}
                <motion.div 
                  className="bg-[#2E6F40] text-white px-6 py-2 rounded-full self-start font-medium text-[1.5vw]"
                  initial={{ opacity: 0, scale: 0.5, y: 20 }}
                  animate={phase >= 2 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  Defense Found
                </motion.div>

                <motion.div 
                  className="bg-white rounded-xl shadow-lg border-2 border-[#2E6F40]/20 p-8 flex flex-col gap-4"
                  initial={{ opacity: 0, y: 20 }}
                  animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  <h3 className="text-[2vw] font-display text-[#1A2E35]">Improper Notice of Eviction</h3>
                  <p className="text-[1.2vw] text-[#4A5B63]">The landlord failed to provide the required 30-day notice under local tenancy laws before initiating proceedings.</p>
                  
                  {/* Citation chips */}
                  <div className="flex flex-wrap gap-3 mt-4">
                    {[
                      "Civ. Code § 1946.1",
                      "Local Rent Ordinance",
                      "Procedural Defect"
                    ].map((chip, i) => (
                      <motion.div 
                        key={chip}
                        className="bg-[#EBE7DF] text-[#1A2E35] px-4 py-1.5 rounded text-[1vw] font-mono"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.4, delay: i * 0.15 }}
                      >
                        {chip}
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

              </div>
            </div>
          </div>
        </BrowserMockup>
      </div>

      <AnimatedCaption text="Lexor reads it, explains it in plain language, and finds the laws on your side." phase={phase >= 1 ? 1 : 0} />
    </motion.div>
  );
}
