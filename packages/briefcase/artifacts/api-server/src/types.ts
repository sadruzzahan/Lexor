import "express";

declare module "express-serve-static-core" {
  interface Request {
    demoUser?: {
      id: string;
      slug: string;
    };
  }
}

export {};
