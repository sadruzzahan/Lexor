import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BrowserMockup, AnimatedCaption } from '../ui/Mockups';
import uploadImg from '@assets/screenshots/02-upload.jpg';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 2000), // drop action
      setTimeout(() => setPhase(3), 8000), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div className="w-[85vw] h-[75vh]">
        <BrowserMockup className="w-full h-full relative">
          <motion.img 
            src={uploadImg} 
            className="w-full h-full object-cover object-top"
            animate={{ scale: [1, 1.02] }}
            transition={{ duration: 9, ease: 'linear' }}
          />
          
          {/* Animated drop zone affordance */}
          <motion.div 
            className="absolute inset-0 bg-[#D66853]/10 border-4 border-dashed border-[#D66853] rounded-xl m-12 flex items-center justify-center backdrop-blur-sm"
            initial={{ opacity: 0, scale: 1.1 }}
            animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div 
              className="bg-white px-8 py-4 rounded-full shadow-lg text-[#1A2E35] font-medium text-[2vw]"
              animate={{ y: [0, -10, 0] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            >
              Processing document...
            </motion.div>
          </motion.div>
        </BrowserMockup>
      </motion.div>

      <AnimatedCaption text="Drop a photo. Or paste it. Or send it on WhatsApp." phase={phase >= 1 ? 1 : 0} />
    </motion.div>
  );
}
