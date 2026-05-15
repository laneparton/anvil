import { Cloud, GitPullRequest } from "lucide-react";

export function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function providerIcon(provider: string) {
  return provider === "Bitbucket" ? Cloud : GitPullRequest;
}

export function providerIconTone(provider: string) {
  return provider === "Bitbucket" ? "text-anvil-info" : "text-foreground/70";
}
